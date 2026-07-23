import test from 'node:test';
import assert from 'node:assert/strict';
process.env.SUPABASE_URL='https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY='sb_publishable_example';
process.env.UEM_SECRETS_ENCRYPTION_KEY=Buffer.alloc(32,9).toString('base64');
process.env.UEM_CONNECTOR_RPC_SECRET=Buffer.alloc(32,19).toString('base64');

const WORKSPACE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function req(method='GET',body,query={workspaceId:WORKSPACE,resource:'connectors'}){return{method,query,body,headers:{host:'app.example','x-forwarded-host':'app.example','x-forwarded-proto':'https',origin:'https://app.example',cookie:'lf_access=user-access; lf_refresh=user-refresh','content-length':body?String(JSON.stringify(body).length):'0'}};}
function res(){const headers=new Map();return{statusCode:0,body:'',setHeader(k,v){headers.set(k.toLowerCase(),v);},end(v=''){this.body=v;}};}
function response(payload,status=200){return new Response(JSON.stringify(payload),{status,headers:{'content-type':'application/json'}});}
function authUser(){return response({id:'11111111-1111-4111-8111-111111111111',email:'owner@example.com'});}

test('connector GET returns provider schemas and non-secret identity without sealed data',async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async url=>String(url).endsWith('/auth/v1/user')?authUser():response([{provider:'fleetdm',config_hint:'fleet.example',updated_at:'2026-07-22T17:00:00Z'}]);
  try{
    const {default:handler}=await import('../api/uem/index.js');const output=res();await handler(req(),output);
    assert.equal(output.statusCode,200);const payload=JSON.parse(output.body);
    assert.equal(payload.secretsExposed,false);assert.equal(payload.connectors.find(row=>row.id==='fleetdm').configured,true);
    assert.equal(payload.connectors.find(row=>row.id==='fleetdm').hint,'fleet.example');
    assert.doesNotMatch(output.body,/sealed_config|very-secret/i);
  }finally{globalThis.fetch=original;}
});

test('connector PUT verifies and encrypts before Supabase without returning raw credentials',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),body:String(options.body||'')});
    if(String(url).endsWith('/auth/v1/user'))return authUser();
    if(String(url).includes('/workspace_members'))return response([{role:'owner'}]);
    if(String(url).startsWith('https://example.com/'))return response({hosts:[{id:7,hostname:'Mac QA',serial_number:'QA-7'}],meta:{has_next_results:false}});
    return response([{provider:'fleetdm',config_hint:'example.com',updated_at:'2026-07-22T17:00:00Z'}]);
  };
  try{
    const {default:handler}=await import('../api/uem/index.js');const output=res();const secret='very-secret-CRET';
    await handler(req('PUT',{workspaceId:WORKSPACE,provider:'fleetdm',config:{baseUrl:'https://example.com',apiToken:secret}}),output);
    assert.equal(output.statusCode,200);const payload=JSON.parse(output.body);assert.equal(payload.configured,true);
    assert.deepEqual(payload.connection,{status:'verified',devices:1});
    assert.ok(!output.body.includes(secret));assert.ok(!calls[3].body.includes(secret));
    const rpc=JSON.parse(calls[3].body);assert.equal(rpc.connector_sealed_config.length,10966);assert.equal(rpc.connector_config_hint,'example.com');assert.match(rpc.connector_server_proof,/^[A-Za-z0-9_-]{43}$/);assert.doesNotMatch(rpc.connector_config_hint,/CRET|very-secret|\bID\b/);assert.doesNotMatch(output.body,/server_proof|sealed_config/);
  }finally{globalThis.fetch=original;}
});

test('connector PUT never stores credentials when provider verification fails',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url,options={})=>{
    calls.push({url:String(url),body:String(options.body||'')});
    if(String(url).endsWith('/auth/v1/user'))return authUser();
    if(String(url).includes('/workspace_members'))return response([{role:'owner'}]);
    if(String(url).startsWith('https://example.com/'))return response({error:'invalid token'},401);
    return response([]);
  };
  try{
    const {default:handler}=await import('../api/uem/index.js');const output=res();
    await handler(req('PUT',{workspaceId:WORKSPACE,provider:'fleetdm',config:{baseUrl:'https://example.com',apiToken:'invalid-readonly-token'}}),output);
    assert.equal(output.statusCode,401);
    assert.ok(!calls.some(call=>call.url.includes('upsert_workspace_uem_connector')));
    assert.doesNotMatch(output.body,/invalid-readonly-token|sealed_config|server_proof/);
  }finally{globalThis.fetch=original;}
});

test('connector mutation rejects cross-origin before auth or encryption',async()=>{
  const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls+=1;return authUser();};
  try{
    const {default:handler}=await import('../api/uem/index.js');const request=req('PUT',{workspaceId:WORKSPACE,provider:'fleetdm',config:{baseUrl:'https://fleet.example',apiToken:'very-secret'}});request.headers.origin='https://evil.example';const output=res();await handler(request,output);
    assert.equal(output.statusCode,403);assert.equal(calls,0);
  }finally{globalThis.fetch=original;}
});

test('connector PUT blocks non-admin roles before contacting the provider',async()=>{
  const original=globalThis.fetch;const calls=[];
  globalThis.fetch=async(url)=>{calls.push(String(url));return String(url).endsWith('/auth/v1/user')?authUser():response([{role:'viewer'}]);};
  try{
    const {default:handler}=await import('../api/uem/index.js');const output=res();
    await handler(req('PUT',{workspaceId:WORKSPACE,provider:'fleetdm',config:{baseUrl:'https://example.com',apiToken:'valid-readonly-token'}}),output);
    assert.equal(output.statusCode,403);
    assert.ok(!calls.some(url=>url.startsWith('https://example.com/')));
    assert.ok(!calls.some(url=>url.includes('upsert_workspace_uem_connector')));
  }finally{globalThis.fetch=original;}
});

test('connector DELETE calls bounded RPC without a config body',async()=>{
  const original=globalThis.fetch;const calls=[];globalThis.fetch=async(url,options={})=>{calls.push({url:String(url),body:String(options.body||'')});if(String(url).endsWith('/auth/v1/user'))return authUser();if(String(url).includes('/workspace_members'))return response([{role:'owner'}]);return response(true);};
  try{
    const {default:handler}=await import('../api/uem/index.js');const output=res();await handler(req('DELETE',{workspaceId:WORKSPACE,provider:'jamf'}),output);
    assert.equal(output.statusCode,200);assert.equal(JSON.parse(output.body).deleted,true);const rpc=JSON.parse(calls[2].body);assert.match(rpc.connector_server_proof,/^[A-Za-z0-9_-]{43}$/);assert.doesNotMatch(output.body,/server_proof|sealed_config/);assert.doesNotMatch(calls[2].body,/connector_(sealed_config|config_hint)/i);
  }finally{globalThis.fetch=original;}
});
