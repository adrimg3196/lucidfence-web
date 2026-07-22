// Read-only FleetDM normalizer and fetcher.
// Credentials (FLEET_URL + FLEET_API_TOKEN) are only ever read from server env.
// This module never returns the token and only performs GET requests.

const PLATFORM_MAP = {
  darwin: 'macOS', macos: 'macOS', windows: 'Windows', linux: 'Linux',
  chrome: 'ChromeOS', ios: 'iOS', ipados: 'iPadOS', android: 'Android'
};

function normalizePlatform(value) {
  const raw = String(value || 'unknown').toLowerCase();
  return PLATFORM_MAP[raw] || raw || 'unknown';
}

function riskFromHost(host) {
  const issues = host && typeof host.issues === 'object' ? host.issues : {};
  const critical = issues.critical_vulnerabilities_count;
  const failing = issues.failing_policies_count;
  if (typeof critical === 'number' && critical > 0) return 'critical';
  if (typeof failing === 'number' && failing > 0) return 'high';
  if (new Set(['mia', 'missing']).has(String(host?.status || '').toLowerCase())) return 'medium';
  return 'low';
}

export function normalizeHost(host) {
  const h = host && typeof host === 'object' ? host : {};
  const issues = h.issues && typeof h.issues === 'object' ? h.issues : {};
  const geo = h.geolocation && typeof h.geolocation === 'object' ? h.geolocation : {};
  const geometry = geo.geometry && typeof geo.geometry === 'object' ? geo.geometry : {};
  const coords = geometry.coordinates;
  let lat = null, lng = null;
  if (
    Array.isArray(coords) && coords.length === 2 &&
    coords.every(item => typeof item === 'number' && !Number.isNaN(item)) &&
    coords[0] >= -90 && coords[0] <= 90 && coords[1] >= -180 && coords[1] <= 180
  ) {
    // Fleet documents geometry.coordinates as [latitude, longitude].
    lat = coords[0];
    lng = coords[1];
  }
  const failing = issues.failing_policies_count;
  const compliant = typeof failing === 'number' ? failing === 0 : null;
  const labels = Array.isArray(h.labels) ? h.labels : [];
  const mdm = h.mdm && typeof h.mdm === 'object' ? h.mdm : {};
  return {
    id: String(h.uuid || h.id || ''),
    fleetHostId: h.id ?? null,
    name: String(h.display_name || h.hostname || 'Device'),
    platform: normalizePlatform(h.platform),
    osVersion: String(h.os_version || ''),
    status: String(h.status || 'unknown'),
    lastSeen: h.seen_time ?? null,
    detailUpdatedAt: h.detail_updated_at ?? null,
    lat,
    lng,
    coordinatesRaw: Array.isArray(coords) ? coords : null,
    locationSource: lat !== null ? 'fleet_geoip' : 'unknown',
    locationAccuracy: lat !== null ? 'coarse' : 'unknown',
    countryIso: geo.country_iso ?? null,
    cityName: geo.city_name ?? null,
    compliant,
    risk: riskFromHost(h),
    failingPoliciesCount: typeof failing === 'number' ? failing : null,
    criticalVulnerabilitiesCount: typeof issues.critical_vulnerabilities_count === 'number' ? issues.critical_vulnerabilities_count : null,
    labels: labels.filter(item => item && typeof item === 'object' && item.name).map(item => String(item.name)),
    fleetId: h.fleet_id ?? null,
    fleetName: h.fleet_name ?? null,
    mdmEnrollmentStatus: mdm.enrollment_status ?? null,
    mdmDeviceStatus: mdm.device_status ?? null,
    mdmPendingAction: mdm.pending_action ?? null,
    source: 'fleetdm',
    readOnly: true
  };
}

export async function fetchFleetHosts(base, token, fleetId, signal, fetchImpl = fetch, maxPages = 100, dispatcher = null) {
  const hosts = [];
  for (let page = 0; page < maxPages; page += 1) {
    const params = new URLSearchParams({
      page: String(page),
      per_page: '100',
      populate_software: 'without_vulnerability_details',
      populate_policies: 'true',
      populate_labels: 'true',
      include_device_status: 'true'
    });
    if (fleetId) params.set('fleet_id', fleetId);
    const url = `${base.replace(/\/+$/, '')}/api/v1/fleet/hosts?${params.toString()}`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal,
      redirect: 'error',
      ...(dispatcher ? { dispatcher } : {})
    });
    if (!response.ok) {
      const retry = response.headers?.get?.('retry-after');
      const suffix = retry ? `; retry-after=${retry}` : '';
      throw new Error(`Fleet returned HTTP ${response.status}${suffix}`);
    }
    const payload = await response.json();
    const batch = Array.isArray(payload?.hosts) ? payload.hosts : [];
    if (!Array.isArray(payload?.hosts)) throw new Error('Fleet response does not contain a hosts list');
    for (const item of batch) if (item && typeof item === 'object') hosts.push(item);
    const meta = payload?.meta && typeof payload.meta === 'object' ? payload.meta : {};
    if (batch.length < 100 || meta.has_next_results === false) break;
  }
  return hosts.slice(0, 10000);
}
