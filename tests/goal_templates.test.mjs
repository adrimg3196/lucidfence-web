import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
await import(new URL('../web-core.js', import.meta.url));
const Core=globalThis.LucidFenceWeb;
const read=name=>readFile(new URL('../'+name, import.meta.url),'utf8');
const appSource=await read('web-app.js');
assert.ok(appSource.includes("getElementById('fleetRows')"));
assert.ok(appSource.includes("parentElement.classList.add('card-body')"));
assert.ok((await read('index.html')).includes('table-scroll'));
assert.ok((await read('web.html')).includes('table-scroll'));

test('recommended /goal chooses critical risk first',()=>{
  const state=Core.initialState();
  const goal=Core.createRecommendedGoal(state,'recommend');
  assert.equal(goal.templateId,'critical');
  assert.equal(goal.metric.name,'critical_devices');
  assert.equal(goal.metric.target,0);
  assert.equal(goal.autonomy,'recommend');
  assert.ok(goal.constraints.includes('Multi-UEM solo lectura'));
});

test('/goal cycle measures the selected metric, not a hardcoded Fleet metric',()=>{
  const state=Core.initialState();
  state.devices=[{id:'1',provider:'intune',risk:'low',fenceState:'inside',compliant:true}];
  const goal=Core.createGoal(state,{title:'Compliance',outcome:'95 percent',target:95,metricName:'compliance_percent',direction:'min',templateId:'compliance',autonomy:'recommend'});
  Core.runCycle(state,Core.snapshot(state));
  assert.equal(goal.metric.current,100);
  assert.equal(goal.status,'achieved');
  assert.equal(Core.snapshot(state).providers,1);
});

test('empty inventory reports unknown compliance and cannot achieve a compliance goal',()=>{
  const state=Core.initialState();
  state.devices=[];
  const goal=Core.createGoal(state,{title:'Compliance',outcome:'95 percent',target:95,metricName:'compliance_percent',direction:'min'});
  const snap=Core.snapshot(state);
  assert.equal(snap.compliance,null);
  Core.runCycle(state,snap);
  assert.equal(goal.metric.current,null);
  assert.equal(goal.status,'active');
});

test('goal threshold directions mean minimum acceptable and maximum allowed',()=>{
  const minimum=Core.initialState();minimum.goals=[];
  const compliance=Core.createGoal(minimum,{title:'Compliance',outcome:'95 percent',target:95,metricName:'compliance_percent',direction:'min'});
  Core.runCycle(minimum,{devices:1,outside:0,unknown:0,critical:0,compliance:94});
  assert.equal(compliance.status,'active');
  const maximum=Core.initialState();maximum.goals=[];
  const outside=Core.createGoal(maximum,{title:'Outside',outcome:'zero',target:0,metricName:'outside_devices',direction:'max'});
  Core.runCycle(maximum,{devices:1,outside:1,unknown:0,critical:0,compliance:100});
  assert.equal(outside.status,'active');
});

test('geofencing classifies only fresh and accurate local evidence',()=>{
  const fences=[{id:'madrid',lat:40.4168,lng:-3.7038,radiusM:900}],observedAt='2026-07-27T12:00:00Z',nowMs=Date.parse('2026-07-27T12:05:00Z');
  const devices = Core.applyGeofences([
    { id: 'inside', lat: 40.417, lng: -3.704, accuracyM: 20, locationObservedAt: observedAt, locationSource: 'local', locationAccuracy: 'precise' },
    { id: 'outside', lat: 41, lng: -3, accuracyM: 20, locationObservedAt: observedAt, locationSource: 'local', locationAccuracy: 'precise' },
    { id: 'missing', lat: null, lng: null, accuracyM: 20, locationObservedAt: observedAt, locationSource: 'local', locationAccuracy: 'precise' },
    { id: 'stale', lat: null, lng: null, accuracyM: 20, locationObservedAt: '2026-07-27T11:55:00Z', locationSource: 'local', locationAccuracy: 'precise' },
    { id: 'inaccurate', lat: 40.417, lng: -3.704, accuracyM: 700, locationObservedAt: observedAt, locationSource: 'local', locationAccuracy: 'precise' }
  ], fences, { nowMs });
  assert.equal(devices[0].fenceState,'inside');
  assert.equal(devices[0].matchedFenceId,'madrid');
  assert.equal(devices[1].fenceState,'outside');
  assert.equal(devices[2].fenceState,'unknown');
});

test('demo fence states agree with the real Haversine classifier',()=>{
  const state=Core.initialState();
  const classified=Core.applyGeofences(state.devices,state.geofences);
  assert.deepEqual(classified.map(device=>device.fenceState),state.devices.map(device=>device.fenceState));
});

test('Multi-UEM evidence uses neutral uem sources',()=>{
  const state=Core.initialState();
  state.goals=[];
  Core.createGoal(state,{title:'Outside',outcome:'zero',target:0,metricName:'outside_devices',direction:'max'});
  const result=Core.runCycle(state,{devices:1,outside:1,unknown:0,critical:0,compliance:100});
  assert.ok(result.tasks.some(task=>task.evidence[0].source==='uem.outside'));
  assert.ok(!JSON.stringify(result).includes('fleet.outside'));
});
