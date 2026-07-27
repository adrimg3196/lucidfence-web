import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_example';
process.env.UEM_ALLOWED_WORKSPACE_IDS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
process.env.UEM_SECRETS_ENCRYPTION_KEY=Buffer.alloc(32,10).toString('base64');
process.env.UEM_CONNECTOR_RPC_SECRET=Buffer.alloc(32,20).toString('base64');

const WORKSPACE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function req(method='GET',query={provider:'status',workspaceId:WORKSPACE},cookie='lf_access=user-access; lf_refresh=user-refresh'){
  return{method,query,headers:{host:'app.example','x-forwarded-host':'app.example','x-forwarded-proto':'https',cookie}};
}
function res(){const headers=new Map();return{statusCode:0,body:'',setHeader(k,v){headers.set(k.toLowerCase(),v);},end(v=''){this.body=v;}};}
function authUser(){return new Response(JSON.stringify({id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com'}),{status:200,headers:{'content-type':'application/json'}});}
function membership(role='owner'){return new Response(JSON.stringify([{role}]),{status:200,headers:{'content-type':'application/json'}});}

test('Multi-UEM BFF rejects mutable methods before provider access',async()=>{
  let calls=0;const original=globalThis.fetch;globalThis.fetch=async()=>{calls+=1;return new Response('{}',{status:200});};
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req('POST'),response);assert.equal(response.statusCode,405);assert.equal(calls,0);}finally{globalThis.fetch=original;}
});

test('Multi-UEM BFF requires an authenticated cloud session',async()=>{
  const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req('GET',undefined,''),response);assert.equal(response.statusCode,401);assert.equal(JSON.parse(response.body).error,'authentication_required');
});

test('Multi-UEM status checks workspace RBAC and managed connectors before returning metadata',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{calls+=1;if(String(url).endsWith('/auth/v1/user'))return authUser();if(String(url).includes('workspace_members'))return membership('owner');return new Response(JSON.stringify([{provider:'fleetdm',config_hint:'fleet.example · ID 10478037',updated_at:'2026-07-22T17:00:00Z'}]),{status:200,headers:{'content-type':'application/json'}});};
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req(),response);assert.equal(response.statusCode,200);const payload=JSON.parse(response.body);assert.equal(payload.readOnly,true);assert.equal(payload.managedCredentials,true);assert.ok(payload.providers.length>=8);assert.equal(payload.providers.find(item=>item.id==='fleetdm').source,'workspace');assert.equal(calls,3);assert.ok(!JSON.stringify(payload).match(/client_secret|api_token|Bearer /i));}finally{globalThis.fetch=original;}
});

test('managed synchronization sends server proof only to the sealed-config RPC',async()=>{
  const original=globalThis.fetch,calls=[];
  const {sealConnectorConfig}=await import('../api/_lib/connectors.js');
  const sealed=sealConnectorConfig({baseUrl:'https://example.com',apiToken:'managed-token-123'},WORKSPACE,'fleetdm');
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),body:String(options.body||'')});
    if(String(url).endsWith('/auth/v1/user'))return authUser();
    if(String(url).includes('workspace_members'))return membership('operator');
    if(String(url).includes('workspace_state'))return new Response(JSON.stringify([{payload:{geofences:[{id:'hq',lat:40.4168,lng:-3.7038,radiusM:900}]}}]),{status:200,headers:{'content-type':'application/json'}});
    if(String(url).includes('load_workspace_uem_connector'))return new Response(JSON.stringify([{provider:'fleetdm',sealed_config:sealed}]),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({hosts:[{id:7,uuid:'host-7',hostname:'Campo',platform:'linux',geolocation:{geometry:{coordinates:[40.4168,-3.7038]}}}],meta:{has_next_results:false}}),{status:200,headers:{'content-type':'application/json'}});
  };
  try{
    const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req('GET',{provider:'fleetdm',workspaceId:WORKSPACE}),response);
    assert.equal(response.statusCode,200);const payload=JSON.parse(response.body),rpc=JSON.parse(calls.find(call=>call.url.includes('load_workspace_uem_connector')).body);
    assert.match(rpc.connector_server_proof,/^[A-Za-z0-9_-]{43}$/);assert.doesNotMatch(response.body,/server_proof|sealed_config|managed-token/);
    assert.equal(payload.devices[0].fenceState,'unknown');assert.equal(payload.devices[0].locationRejectionReason,'invalid_accuracy');
  }finally{globalThis.fetch=original;}
});

test('Multi-UEM BFF denies a different tenant membership before connector storage access',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{calls+=1;return String(url).endsWith('/auth/v1/user')?authUser():membership('viewer');};
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req('GET',{provider:'status',workspaceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),response);assert.equal(response.statusCode,403);assert.equal(JSON.parse(response.body).error,'workspace_role_denied');assert.equal(calls,2);}finally{globalThis.fetch=original;}
});

test('Multi-UEM BFF denies viewer role',async()=>{
  const original=globalThis.fetch;globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?authUser():membership('viewer');
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req(),response);assert.equal(response.statusCode,403);assert.equal(JSON.parse(response.body).error,'workspace_role_denied');}finally{globalThis.fetch=original;}
});

test('legacy Fleet-only endpoint is retired and cannot bypass workspace binding',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls+=1;return authUser();};
  try{const {default:handler}=await import('../api/fleet/hosts.js');const response=res();await handler(req(),response);assert.equal(response.statusCode,410);assert.equal(JSON.parse(response.body).error,'fleet_endpoint_moved');assert.equal(calls,1);}finally{globalThis.fetch=original;}
});

test('Multi-UEM ingestion source contains no destructive device command routes',async()=>{
  const {readFile}=await import('node:fs/promises');const source=await readFile(new URL('../api/_lib/uem.js',import.meta.url),'utf8');assert.doesNotMatch(source,/remoteLock|eraseDevice|\/commands|factory_reset|wipe/i);
});
