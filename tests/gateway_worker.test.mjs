import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../gateway/worker.mjs';

const request=()=>new Request('https://gateway.example/v1/fleet',{method:'GET',headers:{origin:'https://app.example'}});
const baseEnv={ALLOWED_ORIGIN:'https://app.example',UPSTREAM_TOKEN:'hidden'};

test('gateway blocks private or cross-origin upstream before sending credentials',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls+=1;return new Response('{}');};
  try{
    let response=await worker.fetch(request(),{...baseEnv,UPSTREAM_BASE_URL:'https://127.0.0.1'});
    assert.equal(response.status,503);
    response=await worker.fetch(request(),{...baseEnv,UPSTREAM_BASE_URL:'https://provider.example',FLEET_PATH:'https://evil.example/devices'});
    assert.equal(response.status,503);
    assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('gateway performs GET without redirects and preserves geofence evidence',async()=>{
  const original=globalThis.fetch;let options;
  globalThis.fetch=async(url,input)=>{options=input;return new Response(JSON.stringify({devices:[{id:'d1',provider:'hexnode',name:'Phone',platform:'android',compliant:true,lat:40.4,lng:-3.7,locationSource:'hexnode_mdm',locationAccuracy:'precise_mdm'}]}),{status:200,headers:{'content-type':'application/json'}});};
  try{
    const response=await worker.fetch(request(),{...baseEnv,UPSTREAM_BASE_URL:'https://provider.example'});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(payload.readOnly,true);
    assert.equal(payload.devices[0].provider,'hexnode');
    assert.equal(payload.devices[0].lat,40.4);
    assert.equal(payload.devices[0].locationAccuracy,'precise_mdm');
    assert.ok(!JSON.stringify(payload).includes('hidden'));
  }finally{globalThis.fetch=original;}
});
