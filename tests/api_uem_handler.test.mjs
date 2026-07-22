import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_example';
process.env.UEM_ALLOWED_WORKSPACE_IDS='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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

test('Multi-UEM status checks allowlist and workspace RBAC before returning metadata',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async url=>{calls+=1;return String(url).endsWith('/auth/v1/user')?authUser():membership('owner');};
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req(),response);assert.equal(response.statusCode,200);const payload=JSON.parse(response.body);assert.equal(payload.readOnly,true);assert.ok(payload.providers.length>=8);assert.equal(calls,2);assert.ok(!JSON.stringify(payload).match(/client_secret|api_token|Bearer /i));}finally{globalThis.fetch=original;}
});

test('Multi-UEM BFF denies a different tenant before provider or membership access',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls+=1;return authUser();};
  try{const {default:handler}=await import('../api/uem/index.js');const response=res();await handler(req('GET',{provider:'status',workspaceId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'}),response);assert.equal(response.statusCode,403);assert.equal(JSON.parse(response.body).error,'workspace_connector_denied');assert.equal(calls,1);}finally{globalThis.fetch=original;}
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
