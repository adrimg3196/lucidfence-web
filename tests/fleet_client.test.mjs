import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

await import(new URL('../web-fleet.js', import.meta.url));
await import(new URL('../web-core.js', import.meta.url));
const Fleet = globalThis.LucidFenceFleet;
const sanitizeImport = globalThis.LucidFenceWeb.sanitizeImport;

function makeCloud(payload) {
  return { request: async () => payload };
}

test('fleet client loads normalized read-only devices', async () => {
  const payload = {
    source: 'fleetdm',
    readOnly: true,
    count: 1,
    devices: [{ id: 'h1', name: 'Field Mac', platform: 'macOS', lat: 40.4, lng: -3.7 }],
    locationWarning: 'coarse geoip'
  };
  const cloud = makeCloud(payload);
  const { load } = Fleet.create(cloud, sanitizeImport);
  const result = await load();
  assert.equal(result.devices.length, 1);
  const device = result.devices[0];
  assert.equal(device.source, 'fleetdm');
  assert.equal(device.lat, 40.4);
  assert.equal(result.readOnly, true);
});

test('fleet client rejects responses containing secret fields', async () => {
  const payload = {
    devices: [{ id: 'h1', name: 'Leaky', platform: 'macOS', token: 'sb_secret_x', authorization: 'Bearer abc' }]
  };
  const cloud = makeCloud(payload);
  const { load } = Fleet.create(cloud, sanitizeImport);
  await assert.rejects(() => load());
});

test('fleet client surfaces backend errors', async () => {
  const cloud = { request: async () => { throw new Error('HTTP 503'); } };
  const { load } = Fleet.create(cloud, sanitizeImport);
  await assert.rejects(() => load(), /HTTP 503/);
});

test('fleet client rejects oversized fleets', async () => {
  const devices = Array.from({ length: 10001 }, (_, i) => ({ id: 'd' + i }));
  const cloud = makeCloud({ source: 'fleetdm', devices });
  const { load } = Fleet.create(cloud, sanitizeImport);
  await assert.rejects(() => load(), /inválida/);
});
