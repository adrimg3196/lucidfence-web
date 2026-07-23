import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeDevices, normalizeApplivery, normalizeIntune, normalizeJamf,
  providerRegistry, syncAllProviders, syncProvider, validateProviderUrl, assertPublicResolution, pinnedDispatcher
} from '../api/_lib/uem.js';

const PUBLIC_DNS=async()=>[{address:'93.184.216.34',family:4}];

test('provider registry exposes a neutral Multi-UEM catalog without secrets', () => {
  const rows = providerRegistry({ FLEET_URL: 'https://fleet.example', FLEET_API_TOKEN: 'hidden', INTUNE_TENANT_ID: 't', INTUNE_CLIENT_ID: 'c', INTUNE_CLIENT_SECRET: 'hidden' });
  assert.deepEqual(rows.map(row => row.id), ['fleetdm','applivery','intune','jamf','hexnode','workspace-one','chromeos','custom-gateway']);
  assert.equal(rows.find(row => row.id === 'fleetdm').configured, true);
  assert.equal(rows.find(row => row.id === 'intune').configured, true);
  assert.ok(!JSON.stringify(rows).includes('hidden'));
});

test('provider normalizers produce the common read-only device shape', () => {
  const applivery = normalizeApplivery({
    id:'a1',type:'ios',state:'ACTIVE',displayName:'iPhone Campo',lastStatusReportTime:'2026-07-09T12:00:00Z',
    summary:{name:'iPhone Campo',os:'iOS 18',serialNumber:'SER-1',compliance:{isCompliance:false}},
    lastLocation:{agent:{latitude:40.4,longitude:-3.7,date:'2026-07-09T11:59:00Z',address:{city:'Madrid',country:'Spain'}}}
  });
  const intune = normalizeIntune({ id:'i1', deviceName:'Surface', operatingSystem:'Windows', complianceState:'compliant', serialNumber:'SER-2' });
  const jamf = normalizeJamf({ id:'j1', general:{ name:'Mac', platform:'macOS', serialNumber:'SER-3' } });
  assert.equal(applivery.provider, 'applivery');
  assert.equal(applivery.name, 'iPhone Campo');
  assert.equal(applivery.platform, 'iOS');
  assert.equal(applivery.status, 'ACTIVE');
  assert.equal(applivery.osVersion, 'iOS 18');
  assert.equal(applivery.compliant, false);
  assert.equal(applivery.lastSeen, '2026-07-09T12:00:00Z');
  assert.equal(applivery.locationObservedAt, '2026-07-09T11:59:00Z');
  assert.equal(applivery.cityName, 'Madrid');
  assert.equal(applivery.locationAccuracy, 'precise_mdm');
  assert.equal(applivery.risk, 'high');
  assert.equal(intune.compliant, true);
  assert.equal(jamf.compliant, null);
  for (const item of [applivery,intune,jamf]) assert.equal(item.readOnly, true);
});

test('mergeDevices deduplicates cross-UEM by serial and preserves evidence', () => {
  const a = normalizeApplivery({ id:'a1', name:'Shared', platform:'ios', is_compliant:true, serial_number:'SER-X', last_location:{latitude:40,longitude:-3} });
  const b = normalizeIntune({ id:'i1', deviceName:'Shared', operatingSystem:'ios', complianceState:'noncompliant', serialNumber:'SER-X' });
  const merged = mergeDevices([a,b]);
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].providerSources.sort(),['applivery','intune']);
  assert.equal(merged[0].compliant,false);
  assert.equal(merged[0].risk,'high');
  assert.equal(merged[0].lat,40);
  assert.equal(merged[0].evidence.length,2);
});

test('mergeDevices ignores placeholder identities and joins on any shared identifier', () => {
  const placeholderA=normalizeApplivery({id:'a',name:'A',serial_number:'N/A'});
  const placeholderB=normalizeIntune({id:'b',deviceName:'B',serialNumber:'N/A'});
  assert.equal(mergeDevices([placeholderA,placeholderB]).length,2);

  const both=normalizeApplivery({id:'c',name:'Shared',serial_number:'SER-Y',imei:'IMEI-Y'});
  const imeiOnly=normalizeIntune({id:'d',deviceName:'Shared',imei:'IMEI-Y'});
  const serialOnly=normalizeJamf({id:'e',name:'Shared',serialNumber:'SER-Y'});
  const merged=mergeDevices([both,imeiOnly,serialOnly]);
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].providerSources.sort(),['applivery','intune','jamf']);
});

test('mergeDevices prefers precise MDM coordinates over coarse evidence', () => {
  const coarse={...normalizeIntune({id:'i',deviceName:'Shared',serialNumber:'SER-P'}),lat:41,lng:-4,locationSource:'fleet_geoip',locationAccuracy:'coarse'};
  const precise=normalizeApplivery({id:'a',name:'Shared',serial_number:'SER-P',last_location:{latitude:40.4168,longitude:-3.7038}});
  const merged=mergeDevices([coarse,precise]);
  assert.equal(merged.length,1);
  assert.equal(merged[0].locationAccuracy,'precise_mdm');
  assert.equal(merged[0].lat,40.4168);
});

test('provider URL validation blocks SSRF-style configuration', () => {
  for (const unsafe of ['http://127.0.0.1:9000','https://127.0.0.1','https://localhost','https://169.254.169.254','https://10.0.0.1','https://100.64.0.1','https://192.0.2.1','https://192.88.99.1','https://198.18.0.1','https://203.0.113.1','https://192.168.1.2','https://[::1]','https://[2001:db8::1]','https://[3fff::1]']) {
    assert.throws(() => validateProviderUrl(unsafe, 'fleetdm', false), /public HTTPS/);
  }
  assert.throws(() => validateProviderUrl('https://user:pass@example.com', 'jamf', false), /public HTTPS/);
  assert.throws(() => validateProviderUrl('https://example.com?token=x', 'jamf', false), /public HTTPS/);
  assert.throws(() => validateProviderUrl('https://example.com/internal', 'jamf', false), /must not contain a path/);
  assert.equal(validateProviderUrl('https://example.com', 'jamf', false).origin, 'https://example.com');
});

test('DNS resolution blocks public-looking hostnames that resolve privately', async () => {
  const parsed=validateProviderUrl('https://127.0.0.1.nip.io','fleetdm',false);
  await assert.rejects(
    () => assertPublicResolution(parsed,'fleetdm',async()=>[{address:'127.0.0.1',family:4}]),
    error => error?.code === 'private_provider_address'
  );
  for(const address of ['100.64.0.1','192.0.0.1','192.0.2.1','192.88.99.1','192.88.99.255','198.18.0.1','198.51.100.1','203.0.113.1','224.0.0.1','240.0.0.1','2001:2::1','2001:db8::1','2002::1','3fff::1','fc00::1','fe80::1','ff00::1']){
    await assert.rejects(()=>assertPublicResolution(parsed,'fleetdm',async()=>[{address,family:address.includes(':')?6:4}]),error=>error?.code==='private_provider_address',address);
  }
  await assert.rejects(() => assertPublicResolution(parsed,'fleetdm',async()=>[{address:'::ffff:127.0.0.1',family:6}]),error=>error?.code==='private_provider_address');
  await assert.doesNotReject(() => assertPublicResolution(parsed,'fleetdm',async()=>[{address:'8.8.8.8',family:4}]));
  await assert.doesNotReject(() => assertPublicResolution(parsed,'fleetdm',async()=>[{address:'2606:4700:4700::1111',family:6}]));
});

test('pinned dispatcher reuses the validated address without DNS lookup', async () => {
  class FakeAgent { constructor(options){this.options=options;} async close(){} }
  const dispatcher=pinnedDispatcher([{address:'93.184.216.34',family:4}],FakeAgent);
  const resolved=await new Promise((resolve,reject)=>dispatcher.options.connect.lookup('provider.example',{},(error,address,family)=>error?reject(error):resolve({address,family})));
  assert.deepEqual(resolved,{address:'93.184.216.34',family:4});
  await dispatcher.close();
});

test('Fleet placeholder serials do not collapse unrelated hosts', async () => {
  const fakeFetch=async()=>new Response(JSON.stringify({hosts:[
    {id:1,uuid:'f1',display_name:'One',hardware_serial:'N/A'},
    {id:2,uuid:'f2',display_name:'Two',hardware_serial:'N/A'}
  ],meta:{has_next_results:false}}),{status:200,headers:{'content-type':'application/json'}});
  const devices=await syncProvider('fleetdm',{FLEET_URL:'https://fleet.example',FLEET_API_TOKEN:'hidden'},null,fakeFetch,PUBLIC_DNS);
  assert.equal(devices[0].serialNumber,'');
  assert.equal(mergeDevices(devices).length,2);
});

test('Applivery pagination cannot redirect credentials to another origin', async () => {
  const response = new Response(JSON.stringify({ data: { items: [] } }), { status: 200, headers: { 'content-type': 'application/json', link: '<https://evil.example/steal>; rel="next"' } });
  await assert.rejects(
    () => syncProvider('applivery', { APPLIVERY_API_KEY: 'hidden', APPLIVERY_ORG_ID: 'org', APPLIVERY_API_BASE: 'https://api.example/v1' }, null, async () => response, PUBLIC_DNS),
    error => error?.code === 'unsafe_pagination'
  );
});

test('Jamf uses current OAuth client-credentials and v2 inventory endpoints', async () => {
  const calls=[];
  const fakeFetch=async (url,options)=>{
    calls.push({url:String(url),options});
    if(String(url).endsWith('/api/v1/oauth/token')) return new Response(JSON.stringify({access_token:'short-lived'}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({totalCount:1,results:[{id:'j1',name:'iPad',serialNumber:'SER-J'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  const devices=await syncProvider('jamf',{JAMF_BASE_URL:'https://tenant.jamfcloud.com',JAMF_CLIENT_ID:'client',JAMF_CLIENT_SECRET:'hidden'},null,fakeFetch,PUBLIC_DNS);
  assert.equal(calls[0].url,'https://tenant.jamfcloud.com/api/v1/oauth/token');
  assert.equal(calls[0].options.method,'POST');
  assert.equal(calls[0].options.redirect,'error');
  assert.equal(calls[0].options.body.get('grant_type'),'client_credentials');
  assert.equal(calls[1].options.redirect,'error');
  assert.match(calls[1].url,/\/api\/v2\/mobile-devices\?page=0&page-size=200/);
  assert.equal(devices.length,1);
  assert.equal(devices[0].provider,'jamf');
  assert.ok(!JSON.stringify(devices).includes('short-lived'));
});

test('syncAllProviders tolerates one failed provider and returns successful inventory', async () => {
  const env={ APPLIVERY_API_KEY:'x', APPLIVERY_ORG_ID:'org', APPLIVERY_API_BASE:'https://api.example/v1', JAMF_BASE_URL:'https://jamf.example', JAMF_CLIENT_ID:'id', JAMF_CLIENT_SECRET:'secret' };
  const fakeFetch=async url=>{
    if(String(url).includes('api.example')) return new Response(JSON.stringify({data:{items:[{id:'a1',name:'Phone',platform:'ios',is_compliant:true}]}}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({error:'down'}),{status:503,headers:{'content-type':'application/json'}});
  };
  const result=await syncAllProviders(env,null,fakeFetch,PUBLIC_DNS);
  assert.equal(result.devices.length,1);
  assert.equal(result.providers.find(row=>row.provider==='applivery').status,'ok');
  assert.equal(result.providers.find(row=>row.provider==='jamf').status,'error');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
