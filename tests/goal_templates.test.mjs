import test from 'node:test';
import assert from 'node:assert/strict';
await import(new URL('../web-core.js', import.meta.url));
const Core=globalThis.LucidFenceWeb;

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

test('geofencing classifies normalized UEM coordinates without treating missing as zero',()=>{
  const fences=[{id:'madrid',lat:40.4168,lng:-3.7038,radiusM:900}];
  const devices=Core.applyGeofences([
    {id:'inside',lat:40.417,lng:-3.704},
    {id:'outside',lat:41,lng:-3},
    {id:'missing',lat:null,lng:null}
  ],fences);
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
