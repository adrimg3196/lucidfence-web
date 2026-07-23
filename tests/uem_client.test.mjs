import test from 'node:test';
import assert from 'node:assert/strict';
await import(new URL('../web-uem.js', import.meta.url));
await import(new URL('../web-core.js', import.meta.url));
const Uem=globalThis.LucidFenceUem;
const sanitize=globalThis.LucidFenceWeb.sanitizeImport;

test('web UEM client lists provider status',async()=>{
  const cloud={request:async path=>{assert.equal(path,'/api/uem?provider=status&workspaceId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');return{providers:[{id:'fleetdm',configured:true}]};}};
  const client=Uem.create(cloud,sanitize);
  assert.deepEqual(await client.status('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),[{id:'fleetdm',configured:true}]);
});

test('web UEM client synchronizes normalized devices',async()=>{
  const cloud={request:async()=>({readOnly:true,providers:[{provider:'intune',status:'ok',count:1}],devices:[{id:'intune:1',provider:'intune',providerSources:['intune'],name:'Surface',platform:'Windows'}]})};
  const result=await Uem.create(cloud,sanitize).sync('all');
  assert.equal(result.readOnly,true);assert.equal(result.devices.length,1);assert.equal(result.devices[0].provider,'intune');
});

test('web UEM client manages workspace connectors through same-origin cloud requests',async()=>{
  const calls=[];const cloud={request:async(path,options={})=>{calls.push({path,options});return path.includes('?')?{connectors:[{id:'fleetdm',configured:false}]}:{ok:true};}};
  const client=Uem.create(cloud,sanitize),workspace='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  assert.equal((await client.connectors(workspace))[0].id,'fleetdm');
  await client.saveConnector(workspace,'fleetdm',{baseUrl:'https://fleet.example',apiToken:'hidden'});
  await client.deleteConnector(workspace,'fleetdm');
  assert.equal(calls[0].path,`/api/uem/connectors?workspaceId=${workspace}`);
  assert.deepEqual(calls[1],{path:'/api/uem/connectors',options:{method:'PUT',body:{workspaceId:workspace,provider:'fleetdm',config:{baseUrl:'https://fleet.example',apiToken:'hidden'}}}});
  assert.deepEqual(calls[2],{path:'/api/uem/connectors',options:{method:'DELETE',body:{workspaceId:workspace,provider:'fleetdm'}}});
});

test('web UEM client rejects secret fields and oversized inventories',async()=>{
  const leaky={request:async()=>({devices:[{id:'x',token:'secret'}]})};
  await assert.rejects(()=>Uem.create(leaky,sanitize).sync('all'),/campos no permitidos/);
  const huge={request:async()=>({devices:Array.from({length:10001},(_,i)=>({id:String(i)}))})};
  await assert.rejects(()=>Uem.create(huge,sanitize).sync('all'),/inválida/);
});
