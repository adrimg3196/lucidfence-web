import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeHost, fetchFleetHosts } from '../api/_lib/fleet.js';

const SAMPLE = {
  id: 7,
  uuid: 'host-uuid',
  display_name: 'Field Mac',
  platform: 'darwin',
  status: 'online',
  seen_time: '2026-07-21T18:00:00Z',
  issues: { failing_policies_count: 2, critical_vulnerabilities_count: 1 },
  geolocation: { country_iso: 'ES', city_name: 'Madrid', geometry: { type: 'point', coordinates: [40.4168, -3.7038] } },
  labels: [{ name: 'All Hosts' }],
  mdm: { enrollment_status: 'enrolled', device_status: 'unlocked', pending_action: '' }
};

test('normalizeHost maps Fleet fields to LucidFence device', () => {
  const device = normalizeHost(SAMPLE);
  assert.equal(device.platform, 'macOS');
  assert.equal(device.risk, 'critical');
  assert.equal(device.compliant, false);
  assert.equal(device.lat, 40.4168);
  assert.equal(device.lng, -3.7038);
  assert.equal(device.locationSource, 'fleet_geoip');
  assert.equal(device.locationAccuracy, 'coarse');
  assert.deepEqual(device.labels, ['All Hosts']);
  assert.equal(device.source, 'fleetdm');
  assert.equal(device.readOnly, true);
});

test('normalizeHost treats missing GeoIP as unknown, never (0,0)', () => {
  const device = normalizeHost({ id: 1, display_name: 'NoGeo', platform: 'windows', issues: {} });
  assert.equal(device.lat, null);
  assert.equal(device.lng, null);
  assert.equal(device.locationSource, 'unknown');
  assert.equal(device.locationAccuracy, 'unknown');
});

test('normalizeHost never emits a token or secret', () => {
  const device = normalizeHost({ ...SAMPLE, token: 'sb_secret_x', authorization: 'Bearer abc' });
  const encoded = JSON.stringify(device);
  assert.ok(!encoded.includes('Bearer'));
  assert.ok(!encoded.toLowerCase().includes('sb_secret'));
});

test('normalizeHost bounds invalid coordinates to unknown', () => {
  const device = normalizeHost({ id: 1, display_name: 'Bad', platform: 'linux', geolocation: { geometry: { coordinates: [999, 999] } } });
  assert.equal(device.lat, null);
  assert.equal(device.lng, null);
});

test('fetchFleetHosts paginates and normalizes without secrets', async () => {
  const page0 = Array.from({ length: 100 }, (_, i) => ({ id: i, uuid: `u${i}`, display_name: `H${i}`, platform: 'windows', issues: {} }));
  const page1 = [{ id: 100, uuid: 'u100', display_name: 'Droid', platform: 'android', issues: {} }];
  const pages = [
    { hosts: page0, meta: { has_next_results: true } },
    { hosts: page1, meta: { has_next_results: false } }
  ];
  let calls = 0;
  const fakeFetch = async (url, options) => {
    assert.equal(options.method, 'GET');
    assert.match(options.headers.Authorization, /^Bearer /);
    const body = pages[calls];
    calls += 1;
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const hosts = await fetchFleetHosts('https://fleet.example.com', 'tok', '', null, fakeFetch);
  assert.equal(hosts.length, 101);
  assert.equal(calls, 2);
});

test('fetchFleetHosts surfaces HTTP errors with retry-after', async () => {
  const fakeFetch = async () => new Response('', { status: 429, headers: { 'retry-after': '30' } });
  await assert.rejects(() => fetchFleetHosts('https://fleet.example.com', 'tok', '', null, fakeFetch), /HTTP 429; retry-after=30/);
});
