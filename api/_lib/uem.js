import { Agent } from 'undici';
import { lookup as dnsLookup } from 'node:dns/promises';
import { fetchFleetHosts, normalizeHost as normalizeFleetHost } from './fleet.js';

const RISK_RANK = Object.freeze({ unknown: 0, low: 1, medium: 2, high: 3, critical: 4 });
const LOCATION_RANK = Object.freeze({ unknown: 0, coarse: 1, coarse_geoip: 1, precise: 2, precise_mdm: 3 });

export class UemProviderError extends Error {
  constructor(provider, code, message, status = 502) {
    super(message);
    this.name = 'UemProviderError';
    this.provider = provider;
    this.code = code;
    this.status = status;
  }
}

function ipv4Number(value) {
  const parts=String(value||'').split('.').map(Number);
  if(parts.length!==4||parts.some(part=>!Number.isInteger(part)||part<0||part>255))return null;
  return parts.reduce((total,part)=>(total*256)+part,0)>>>0;
}

const NON_GLOBAL_IPV4=Object.freeze([
  ['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],
  ['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],
  ['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]
].map(([address,bits])=>[ipv4Number(address),bits]));

function inIpv4Subnet(value,base,bits){const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;return (value&mask)===(base&mask);}
function ipv6Number(value){
  let raw=String(value||'').toLowerCase().split('%')[0];
  if(raw.includes('.')){const last=raw.slice(raw.lastIndexOf(':')+1),v4=ipv4Number(last);if(v4===null)return null;raw=raw.slice(0,raw.lastIndexOf(':'))+':'+((v4>>>16)&0xffff).toString(16)+':'+(v4&0xffff).toString(16);}
  const halves=raw.split('::');if(halves.length>2)return null;
  const left=halves[0]?halves[0].split(':'):[],right=halves.length===2&&halves[1]?halves[1].split(':'):[];
  const fill=8-left.length-right.length;if(fill<(halves.length===2?1:0))return null;
  const groups=halves.length===2?[...left,...Array(fill).fill('0'),...right]:left;if(groups.length!==8||groups.some(group=>!/^[0-9a-f]{1,4}$/.test(group)))return null;
  return groups.reduce((total,group)=>(total<<16n)+BigInt(Number.parseInt(group,16)),0n);
}
function inIpv6Subnet(value,base,bits){const shift=128n-BigInt(bits);return (value>>shift)===(base>>shift);}
const NON_GLOBAL_IPV6=Object.freeze([
  ['::',128],['::1',128],['64:ff9b:1::',48],['100::',64],['2001::',23],['2001:db8::',32],
  ['2002::',16],['3fff::',20],['fc00::',7],['fe80::',10],['ff00::',8]
].map(([address,bits])=>[ipv6Number(address),bits]));

function nonGlobalAddress(address) {
  const value=String(address||'').toLowerCase();
  if(value.startsWith('::ffff:'))return nonGlobalAddress(value.slice(7));
  const v4=ipv4Number(value);if(v4!==null)return NON_GLOBAL_IPV4.some(([base,bits])=>inIpv4Subnet(v4,base,bits));
  const v6=ipv6Number(value);if(v6===null)return true;
  const globalUnicast=inIpv6Subnet(v6,ipv6Number('2000::'),3);
  return !globalUnicast||NON_GLOBAL_IPV6.some(([base,bits])=>inIpv6Subnet(v6,base,bits));
}

export function validateProviderUrl(value, provider, allowPath = true) {
  let parsed;
  try { parsed = new URL(String(value || '')); }
  catch { throw new UemProviderError(provider, 'invalid_provider_url', `${provider} URL is invalid`, 500); }
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const literalAddress=ipv4Number(host)!==null||host.includes(':');
  const privateHost = host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (literalAddress&&nonGlobalAddress(host));
  if (parsed.protocol !== 'https:' || privateHost || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new UemProviderError(provider, 'invalid_provider_url', `${provider} URL must use public HTTPS without credentials, query or fragment`, 500);
  }
  if (!allowPath && parsed.pathname !== '/') throw new UemProviderError(provider, 'invalid_provider_url', `${provider} URL must not contain a path`, 500);
  return parsed;
}

export async function assertPublicResolution(parsed, provider, resolver = dnsLookup) {
  let records;
  try { records = await resolver(parsed.hostname, { all: true, verbatim: true }); }
  catch { throw new UemProviderError(provider, 'provider_dns_failed', `${provider} hostname could not be resolved`, 502); }
  const rows = Array.isArray(records) ? records : [records];
  if (!rows.length || rows.some(record => nonGlobalAddress(record?.address))) {
    throw new UemProviderError(provider, 'private_provider_address', `${provider} resolved to a non-public address`, 500);
  }
  return rows.map(record => ({ address: String(record.address), family: Number(record.family) || (String(record.address).includes(':') ? 6 : 4) }));
}

export function pinnedDispatcher(records, AgentImpl = Agent) {
  const rows = records.map(record => ({ address: record.address, family: record.family }));
  let cursor = 0;
  return new AgentImpl({ connect: { lookup(hostname, options, callback) {
    if (options?.all) { callback(null, rows); return; }
    const record = rows[cursor++ % rows.length];
    callback(null, record.address, record.family);
  } } });
}

export function providerRegistry(env = process.env) {
  return [
    { id: 'fleetdm', name: 'FleetDM', configured: Boolean(env.FLEET_URL && env.FLEET_API_TOKEN), mode: 'direct', location: 'coarse_geoip' },
    { id: 'applivery', name: 'Applivery', configured: Boolean(env.APPLIVERY_API_KEY && env.APPLIVERY_ORG_ID), mode: 'direct', location: 'mdm' },
    { id: 'intune', name: 'Microsoft Intune', configured: Boolean(env.INTUNE_TENANT_ID && env.INTUNE_CLIENT_ID && env.INTUNE_CLIENT_SECRET), mode: 'direct', location: 'unknown' },
    { id: 'jamf', name: 'Jamf Pro', configured: Boolean(env.JAMF_BASE_URL && env.JAMF_CLIENT_ID && env.JAMF_CLIENT_SECRET), mode: 'direct', location: 'unknown' },
    { id: 'hexnode', name: 'Hexnode', configured: false, mode: 'gateway', location: 'provider_dependent' },
    { id: 'workspace-one', name: 'Workspace ONE', configured: false, mode: 'gateway', location: 'provider_dependent' },
    { id: 'chromeos', name: 'ChromeOS', configured: false, mode: 'gateway', location: 'unknown' },
    { id: 'custom-gateway', name: 'Gateway compatible', configured: Boolean(env.UEM_GATEWAY_URL && env.UEM_GATEWAY_TOKEN), mode: 'gateway', location: 'provider_dependent' }
  ];
}

function platform(value) {
  const raw = String(value || 'unknown').toLowerCase();
  return ({ darwin: 'macOS', macos: 'macOS', windows: 'Windows', windows10: 'Windows', linux: 'Linux', chrome: 'ChromeOS', chromeos: 'ChromeOS', ios: 'iOS', ipados: 'iPadOS', android: 'Android' })[raw] || raw || 'unknown';
}

function point(raw, source = 'unknown', accuracy = 'unknown') {
  const lat = Number(raw?.latitude ?? raw?.lat);
  const lng = Number(raw?.longitude ?? raw?.lng ?? raw?.lon);
  const measuredAccuracy = Number(raw?.accuracyM ?? raw?.accuracy ?? raw?.horizontalAccuracy ?? raw?.horizontal_accuracy);
  const accuracyM = Number.isFinite(measuredAccuracy) && measuredAccuracy >= 0 ? measuredAccuracy : null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { lat: null, lng: null, accuracyM: null, locationSource: 'unknown', locationAccuracy: 'unknown' };
  }
  return { lat, lng, accuracyM, locationSource: source, locationAccuracy: accuracy };
}

function identity(value) {
  const normalized = String(value ?? '').trim();
  return /^(?:|n\/?a|none|null|unknown|not available|0+)$/i.test(normalized) ? '' : normalized;
}

function baseDevice(provider, raw, fields = {}) {
  const id = String(fields.id ?? raw?.id ?? raw?.device_id ?? raw?.deviceId ?? '');
  return {
    id: `${provider}:${id}`,
    providerDeviceId: id,
    provider,
    providerSources: [provider],
    name: String(fields.name ?? raw?.name ?? raw?.deviceName ?? 'Dispositivo'),
    platform: platform(fields.platform ?? raw?.platform ?? raw?.operatingSystem ?? raw?.os),
    osVersion: String(fields.osVersion ?? raw?.osVersion ?? raw?.os_version ?? ''),
    status: String(fields.status ?? raw?.status ?? 'unknown'),
    compliant: typeof fields.compliant === 'boolean' ? fields.compliant : null,
    risk: fields.risk || (fields.compliant === false ? 'high' : 'low'),
    serialNumber: identity(fields.serialNumber ?? raw?.serialNumber ?? raw?.serial_number),
    imei: identity(fields.imei ?? raw?.imei),
    lastSeen: fields.lastSeen ?? raw?.last_seen_at ?? raw?.lastSyncDateTime ?? null,
    observedAt: new Date().toISOString(),
    fenceState: 'unknown',
    readOnly: true,
    ...point(fields.location, fields.locationSource, fields.locationAccuracy),
    evidence: [{ source: provider, observedAt: new Date().toISOString(), kind: 'inventory' }]
  };
}

export function normalizeApplivery(raw) {
  const summary = raw?.summary && typeof raw.summary === 'object' ? raw.summary : {};
  const compliance = summary?.compliance && typeof summary.compliance === 'object' ? summary.compliance : {};
  const compliant = typeof compliance.isCompliance === 'boolean' ? compliance.isCompliance : (typeof raw?.is_compliant === 'boolean' ? raw.is_compliant : null);
  const lastLocation = raw?.lastLocation && typeof raw.lastLocation === 'object' ? raw.lastLocation : (raw?.last_location && typeof raw.last_location === 'object' ? raw.last_location : null);
  const location = lastLocation?.agent || lastLocation?.location || lastLocation;
  const address = lastLocation?.agent?.address && typeof lastLocation.agent.address === 'object' ? lastLocation.agent.address : {};
  const device = baseDevice('applivery', raw, {
    id: raw?.id,
    name: summary.name || raw?.displayName || raw?.name || summary.model || raw?.id,
    platform: raw?.type || raw?.platform,
    status: raw?.state || raw?.status,
    compliant,
    risk: compliant === false ? 'high' : 'low',
    osVersion: summary.os || raw?.os_version,
    serialNumber: summary.serialNumber || raw?.serialNumber || raw?.serial_number,
    imei: summary.imei || raw?.imei,
    lastSeen: raw?.lastStatusReportTime || raw?.last_seen_at,
    location,
    locationSource: location ? 'applivery_mdm' : 'unknown',
    locationAccuracy: location ? 'precise_mdm' : 'unknown'
  });
  device.locationObservedAt = location?.date || lastLocation?.date || null;
  device.cityName = address.city || null;
  device.countryName = address.country || null;
  return device;
}

export function normalizeIntune(raw) {
  const state = String(raw?.complianceState || '').toLowerCase();
  const compliant = state ? state === 'compliant' : null;
  return baseDevice('intune', raw, {
    id: raw?.id,
    name: raw?.deviceName,
    platform: raw?.operatingSystem,
    status: raw?.managementState,
    compliant,
    risk: compliant === false ? 'high' : 'low',
    osVersion: raw?.osVersion,
    serialNumber: raw?.serialNumber,
    imei: raw?.imei,
    lastSeen: raw?.lastSyncDateTime
  });
}

export function normalizeJamf(raw) {
  const general = raw?.general && typeof raw.general === 'object' ? raw.general : raw;
  return baseDevice('jamf', raw, {
    id: raw?.id ?? general?.id,
    name: general?.name,
    platform: general?.platform,
    osVersion: general?.osVersion,
    serialNumber: general?.serialNumber,
    imei: general?.imei,
    lastSeen: general?.lastInventoryUpdateDate,
    compliant: null,
    risk: 'low'
  });
}

export function normalizeGateway(raw, provider = 'custom-gateway') {
  const compliant = typeof raw?.compliant === 'boolean' ? raw.compliant : null;
  const device = baseDevice(provider, raw, {
    id: raw?.providerDeviceId ?? raw?.id,
    name: raw?.name,
    platform: raw?.platform,
    status: raw?.status,
    compliant,
    risk: String(raw?.risk || (compliant === false ? 'high' : 'low')),
    osVersion: raw?.osVersion,
    serialNumber: raw?.serialNumber,
    imei: raw?.imei,
    lastSeen: raw?.lastSeen,
    location: raw,
    locationSource: raw?.locationSource || 'unknown',
    locationAccuracy: raw?.locationAccuracy || 'unknown'
  });
  device.fenceState = ['inside', 'outside', 'unknown'].includes(raw?.fenceState) ? raw.fenceState : 'unknown';
  return device;
}

function identityKeys(device) {
  const keys = [];
  if (device.serialNumber) keys.push(`serial:${device.serialNumber.toLowerCase()}`);
  if (device.imei) keys.push(`imei:${device.imei.toLowerCase()}`);
  if (!keys.length) keys.push(`provider:${device.provider}:${device.providerDeviceId}`);
  return keys;
}

function mergePair(current, device) {
  const sources = [...new Set([...(current.providerSources || []), ...(device.providerSources || [])])];
  const currentRank = current.lat === null ? 0 : (LOCATION_RANK[current.locationAccuracy] || 1);
  const deviceRank = device.lat === null ? 0 : (LOCATION_RANK[device.locationAccuracy] || 1);
  const location = deviceRank > currentRank ? device : current;
  return {
    ...current,
    lat: location.lat,
    lng: location.lng,
    accuracyM: location.accuracyM,
    locationSource: location.locationSource,
    locationAccuracy: location.locationAccuracy,
    locationObservedAt: location.locationObservedAt,
    compliant: current.compliant === false || device.compliant === false ? false : (current.compliant === true || device.compliant === true ? true : null),
    risk: (RISK_RANK[device.risk] || 0) > (RISK_RANK[current.risk] || 0) ? device.risk : current.risk,
    serialNumber: current.serialNumber || device.serialNumber,
    imei: current.imei || device.imei,
    providerSources: sources,
    evidence: [...(current.evidence || []), ...(device.evidence || [])]
  };
}

export function mergeDevices(devices) {
  const groups = [];
  const keyToGroup = new Map();
  for (const device of devices) {
    const keys = identityKeys(device);
    const matches = [...new Set(keys.map(key => keyToGroup.get(key)).filter(Number.isInteger))];
    if (!matches.length) {
      const index = groups.push({ ...device }) - 1;
      for (const key of keys) keyToGroup.set(key, index);
      continue;
    }
    const primary = matches[0];
    let combined = mergePair(groups[primary], device);
    for (const duplicate of matches.slice(1)) {
      combined = mergePair(combined, groups[duplicate]);
      groups[duplicate] = null;
      for (const [key, index] of keyToGroup) if (index === duplicate) keyToGroup.set(key, primary);
    }
    groups[primary] = combined;
    for (const key of identityKeys(combined)) keyToGroup.set(key, primary);
    for (const key of keys) keyToGroup.set(key, primary);
  }
  return groups.filter(Boolean).slice(0, 10000);
}

async function json(response, provider) {
  if (!response.ok) throw new UemProviderError(provider, 'upstream_rejected', `${provider} rejected the inventory request`, response.status === 429 ? 429 : 502);
  const payload = await response.json();
  return payload;
}

async function fetchApplivery(env, signal, fetchImpl, resolver) {
  const baseUrl = validateProviderUrl(env.APPLIVERY_API_BASE || 'https://api.applivery.io/v1', 'applivery');
  const dispatcher = pinnedDispatcher(await assertPublicResolution(baseUrl, 'applivery', resolver));
  try {
    const base = baseUrl.toString().replace(/\/+$/, '');
    let url = `${base}/organizations/${encodeURIComponent(env.APPLIVERY_ORG_ID)}/mdm/devices`;
    const rows = [];
    for (let page = 0; page < 50 && url; page += 1) {
      const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${env.APPLIVERY_API_KEY}`, Accept: 'application/json' }, signal, redirect: 'error', dispatcher });
      const payload = await json(response, 'applivery');
      const data = payload?.data && typeof payload.data === 'object' ? payload.data : payload;
      const items = data?.items || data?.devices || data?.results || [];
      if (!Array.isArray(items)) throw new UemProviderError('applivery', 'invalid_response', 'Applivery returned an invalid device list');
      rows.push(...items);
      const link = response.headers.get('link') || '';
      const match = link.match(/<([^>]+)>;\s*rel="next"/i);
      if (match?.[1]) {
        const next = new URL(match[1], baseUrl);
        if (next.protocol !== 'https:' || next.origin !== baseUrl.origin) throw new UemProviderError('applivery', 'unsafe_pagination', 'Applivery returned an unsafe pagination URL');
        url = next.toString();
      } else url = '';
    }
    return rows.map(normalizeApplivery);
  } finally { await dispatcher.close(); }
}

async function fetchIntune(env, signal, fetchImpl, resolver) {
  const loginUrl = new URL('https://login.microsoftonline.com');
  const loginDispatcher = pinnedDispatcher(await assertPublicResolution(loginUrl, 'intune-login', resolver));
  let tokenPayload;
  try {
    const tokenResponse = await fetchImpl(`https://login.microsoftonline.com/${encodeURIComponent(env.INTUNE_TENANT_ID)}/oauth2/v2.0/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, signal,
      body: new URLSearchParams({ client_id: env.INTUNE_CLIENT_ID, client_secret: env.INTUNE_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' }), redirect: 'error', dispatcher: loginDispatcher
    });
    tokenPayload = await json(tokenResponse, 'intune');
  } finally { await loginDispatcher.close(); }
  if (!tokenPayload?.access_token) throw new UemProviderError('intune', 'invalid_auth_response', 'Intune did not return an access token');
  const graphUrl = new URL('https://graph.microsoft.com');
  const graphDispatcher = pinnedDispatcher(await assertPublicResolution(graphUrl, 'intune-graph', resolver));
  try {
    let url = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=200&$select=id,deviceName,operatingSystem,complianceState,managementState,osVersion,serialNumber,imei,lastSyncDateTime';
    const rows = [];
    for (let page = 0; page < 50 && url; page += 1) {
      const response = await fetchImpl(url, { method: 'GET', headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/json' }, signal, redirect: 'error', dispatcher: graphDispatcher });
      const payload = await json(response, 'intune');
      if (!Array.isArray(payload?.value)) throw new UemProviderError('intune', 'invalid_response', 'Intune returned an invalid device list');
      rows.push(...payload.value);
      if (payload['@odata.nextLink']) {
        const next = new URL(payload['@odata.nextLink']);
        if (next.protocol !== 'https:' || next.origin !== 'https://graph.microsoft.com') throw new UemProviderError('intune', 'unsafe_pagination', 'Intune returned an unsafe pagination URL');
        url = next.toString();
      } else url = '';
    }
    tokenPayload.access_token = '';
    return rows.map(normalizeIntune);
  } finally { await graphDispatcher.close(); }
}

async function fetchJamf(env, signal, fetchImpl, resolver) {
  const baseUrl = validateProviderUrl(env.JAMF_BASE_URL, 'jamf', false);
  const dispatcher = pinnedDispatcher(await assertPublicResolution(baseUrl, 'jamf', resolver));
  try {
    const base = baseUrl.origin;
    const tokenResponse = await fetchImpl(`${base}/api/v1/oauth/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, signal,
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: env.JAMF_CLIENT_ID, client_secret: env.JAMF_CLIENT_SECRET }), redirect: 'error', dispatcher
    });
    const tokenPayload = await json(tokenResponse, 'jamf');
    if (!tokenPayload?.access_token) throw new UemProviderError('jamf', 'invalid_auth_response', 'Jamf did not return an access token');
    const rows = [];
    for (let page = 0; page < 50; page += 1) {
      const response = await fetchImpl(`${base}/api/v2/mobile-devices?page=${page}&page-size=200&sort=id%3Aasc`, { method: 'GET', headers: { Authorization: `Bearer ${tokenPayload.access_token}`, Accept: 'application/json' }, signal, redirect: 'error', dispatcher });
      const payload = await json(response, 'jamf');
      if (!Array.isArray(payload?.results)) throw new UemProviderError('jamf', 'invalid_response', 'Jamf returned an invalid device list');
      rows.push(...payload.results);
      if (payload.results.length < 200 || (Number.isFinite(payload.totalCount) && rows.length >= payload.totalCount)) break;
    }
    tokenPayload.access_token = '';
    return rows.map(normalizeJamf);
  } finally { await dispatcher.close(); }
}

async function fetchGateway(env, signal, fetchImpl, resolver) {
  const baseUrl = validateProviderUrl(env.UEM_GATEWAY_URL, 'custom-gateway', false);
  const dispatcher = pinnedDispatcher(await assertPublicResolution(baseUrl, 'custom-gateway', resolver));
  try {
    const base = baseUrl.origin;
    const response = await fetchImpl(`${base}/v1/fleet`, { method: 'GET', headers: { Authorization: `Bearer ${env.UEM_GATEWAY_TOKEN}`, Accept: 'application/json' }, signal, redirect: 'error', dispatcher });
    const payload = await json(response, 'custom-gateway');
    if (!Array.isArray(payload?.devices)) throw new UemProviderError('custom-gateway', 'invalid_response', 'Gateway returned an invalid device list');
    return payload.devices.map(row => normalizeGateway(row, String(row?.provider || 'custom-gateway')));
  } finally { await dispatcher.close(); }
}

export async function syncProvider(id, env = process.env, signal, fetchImpl = fetch, resolver = dnsLookup) {
  if (id === 'fleetdm') {
    const baseUrl = validateProviderUrl(env.FLEET_URL, 'fleetdm', false);
    const dispatcher = pinnedDispatcher(await assertPublicResolution(baseUrl, 'fleetdm', resolver));
    try {
      const base = baseUrl.origin;
      return (await fetchFleetHosts(base, env.FLEET_API_TOKEN, env.FLEET_FLEET_ID || '', signal, fetchImpl, 100, dispatcher)).map(host => ({ ...normalizeFleetHost(host), provider: 'fleetdm', providerDeviceId: String(host.id ?? ''), providerSources: ['fleetdm'], serialNumber: identity(host.hardware_serial), imei: '', observedAt: new Date().toISOString(), fenceState: 'unknown', evidence: [{ source: 'fleetdm', observedAt: new Date().toISOString(), kind: 'inventory' }] }));
    } finally { await dispatcher.close(); }
  }
  if (id === 'applivery') return fetchApplivery(env, signal, fetchImpl, resolver);
  if (id === 'intune') return fetchIntune(env, signal, fetchImpl, resolver);
  if (id === 'jamf') return fetchJamf(env, signal, fetchImpl, resolver);
  if (id === 'custom-gateway') return fetchGateway(env, signal, fetchImpl, resolver);
  throw new UemProviderError(id, 'provider_not_supported', 'Provider requires a compatible gateway', 400);
}

export async function syncAllProviders(env = process.env, signal, fetchImpl = fetch, resolver = dnsLookup) {
  const configured = providerRegistry(env).filter(provider => provider.configured);
  const outcomes = await Promise.all(configured.map(async provider => {
    try {
      const devices = await syncProvider(provider.id, env, signal, fetchImpl, resolver);
      return { provider: provider.id, status: 'ok', count: devices.length, devices };
    } catch (error) {
      return { provider: provider.id, status: 'error', count: 0, error: error?.code || 'provider_unavailable', devices: [] };
    }
  }));
  const devices = mergeDevices(outcomes.flatMap(item => item.devices));
  return { providers: outcomes.map(({ devices: ignored, ...status }) => status), devices };
}
