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

test('gateway rejects hostnames resolving to non-public addresses before sending credentials',async()=>{
  const original=globalThis.fetch;let upstreamCalls=0,authorizationSeen=false;
  globalThis.fetch=async(url,options={})=>{
    authorizationSeen ||= Boolean(options.headers?.authorization);
    if(String(url).startsWith('https://cloudflare-dns.com/'))return new Response(JSON.stringify({Status:0,Answer:[{type:1,data:'10.23.4.5'}]}),{headers:{'content-type':'application/dns-json'}});
    upstreamCalls+=1;return new Response('{}');
  };
  try{
    const response=await worker.fetch(request(),{...baseEnv,UPSTREAM_BASE_URL:'https://provider.example'});
    assert.equal(response.status,503);
    assert.equal(upstreamCalls,0);
    assert.equal(authorizationSeen,false);
  }finally{globalThis.fetch=original;}
});

test('gateway performs GET without redirects and preserves geofence evidence',async()=>{
  const original=globalThis.fetch;let options;
  globalThis.fetch=async(url,input={})=>{
    if(String(url).startsWith('https://cloudflare-dns.com/'))return new Response(JSON.stringify({Status:0,Answer:String(url).includes('type=AAAA')?[]:[{type:1,data:'93.184.216.34'}]}),{headers:{'content-type':'application/dns-json'}});
    options=input;return new Response(JSON.stringify({devices:[{id:'d1',provider:'hexnode',name:'Phone',platform:'android',compliant:true,lat:40.4,lng:-3.7,accuracyM:15,locationObservedAt:'2026-07-27T12:00:00Z',locationSource:'hexnode_mdm',locationAccuracy:'precise_mdm'}]}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const response=await worker.fetch(request(),{...baseEnv,UPSTREAM_BASE_URL:'https://provider.example'});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.equal(options.method,'GET');
    assert.equal(options.redirect,'error');
    assert.equal(payload.readOnly,true);
    assert.equal(payload.devices[0].provider,'hexnode');
    assert.equal(payload.devices[0].lat,40.4);
    assert.equal(payload.devices[0].accuracyM,15);
    assert.equal(payload.devices[0].locationObservedAt,'2026-07-27T12:00:00Z');
    assert.equal(payload.devices[0].locationAccuracy,'precise_mdm');
    assert.ok(!JSON.stringify(payload).includes('hidden'));
  }finally{globalThis.fetch=original;}
});
