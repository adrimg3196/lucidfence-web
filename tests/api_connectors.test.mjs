import test from 'node:test';
import assert from 'node:assert/strict';
import {
  connectorCatalog, connectorConfigToEnv, connectorHint, connectorRowsToEnv, connectorRpcProof, openConnectorConfig,
  sealConnectorConfig, validateConnectorConfig
} from '../api/_lib/connectors.js';

const WORKSPACE='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const KEY=Buffer.alloc(32,7).toString('base64');
const ENV={UEM_SECRETS_ENCRYPTION_KEY:KEY};
const RPC_SECRET=Buffer.alloc(32,11).toString('base64');
const RPC_ENV={UEM_CONNECTOR_RPC_SECRET:RPC_SECRET};

test('connector vault seals a fixed-size envelope and opens only for its workspace/provider',()=>{
  const config=validateConnectorConfig('fleetdm',{baseUrl:'https://fleet.example.com',apiToken:'very-secret-token',fleetId:'9'});
  const envelope=sealConnectorConfig(config,WORKSPACE,'fleetdm',ENV);
  assert.equal(envelope.length,10966);
  assert.ok(!envelope.includes('very-secret-token'));
  assert.deepEqual(openConnectorConfig(envelope,WORKSPACE,'fleetdm',ENV),config);
  assert.throws(()=>openConnectorConfig(envelope,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','fleetdm',ENV),/cannot be decrypted/);
  assert.throws(()=>openConnectorConfig(envelope,WORKSPACE,'jamf',ENV),/cannot be decrypted/);
  assert.throws(()=>openConnectorConfig(envelope,WORKSPACE,'fleetdm',{UEM_SECRETS_ENCRYPTION_KEY:Buffer.alloc(32,8).toString('base64')}),/cannot be decrypted/);
  const tampered=envelope.split('.');tampered[3]=(tampered[3][0]==='A'?'B':'A')+tampered[3].slice(1);
  assert.throws(()=>openConnectorConfig(tampered.join('.'),WORKSPACE,'fleetdm',ENV),/cannot be decrypted/);
});

test('connector validation rejects unknown, short, control-bearing and unsafe URL fields',()=>{
  assert.throws(()=>validateConnectorConfig('fleetdm',{baseUrl:'https://fleet.example',apiToken:'1234567'}),/too short/);
  assert.throws(()=>validateConnectorConfig('fleetdm',{baseUrl:'http://fleet.example',apiToken:'12345678'}),/public HTTPS/);
  assert.throws(()=>validateConnectorConfig('fleetdm',{baseUrl:'https://127.0.0.1',apiToken:'12345678'}),/public HTTPS/);
  assert.throws(()=>validateConnectorConfig('fleetdm',{baseUrl:'https://fleet.example',apiToken:'12345678',extra:'no'}),/unknown field/);
  assert.throws(()=>validateConnectorConfig('jamf',{baseUrl:'https://jamf.example',clientId:'client\nvalue',clientSecret:'12345678'}),/invalid/);
});

test('catalog and hint expose only non-secret connector identity',()=>{
  const catalog=connectorCatalog();
  assert.deepEqual(catalog.map(item=>item.id),['fleetdm','applivery','intune','jamf','custom-gateway']);
  assert.ok(catalog.find(item=>item.id==='intune').fields.some(field=>field.id==='clientSecret'&&field.secret));
  const hint=connectorHint('fleetdm',{baseUrl:'https://fleet.example.com',apiToken:'top-secret-ABCD'});
  const rotatedHint=connectorHint('fleetdm',{baseUrl:'https://fleet.example.com',apiToken:'password'});
  assert.match(hint,/fleet\.example\.com/);
  assert.equal(rotatedHint,hint);
  assert.doesNotMatch(hint,/top-secret|ABCD|password|\bID\b|10478037/i);
  assert.ok(!JSON.stringify(catalog).includes('top-secret'));
});

test('connector configs map to existing provider environment contracts without mutation fields',()=>{
  assert.deepEqual(connectorConfigToEnv('intune',{tenantId:'t',clientId:'c',clientSecret:'s'}),{
    INTUNE_TENANT_ID:'t',INTUNE_CLIENT_ID:'c',INTUNE_CLIENT_SECRET:'s'
  });
  assert.deepEqual(connectorConfigToEnv('custom-gateway',{baseUrl:'https://gateway.example',token:'hidden'}),{
    UEM_GATEWAY_URL:'https://gateway.example',UEM_GATEWAY_TOKEN:'hidden'
  });
});

test('managed connector rows decrypt directly into existing provider contracts',()=>{
  const fleet=sealConnectorConfig({baseUrl:'https://fleet.example',apiToken:'fleet-secret'},WORKSPACE,'fleetdm',ENV);
  const jamf=sealConnectorConfig({baseUrl:'https://tenant.jamfcloud.com',clientId:'client',clientSecret:'jamf-secret'},WORKSPACE,'jamf',ENV);
  const mapped=connectorRowsToEnv([{provider:'fleetdm',sealed_config:fleet},{provider:'jamf',sealed_config:jamf}],WORKSPACE,ENV);
  assert.equal(mapped.FLEET_URL,'https://fleet.example');
  assert.equal(mapped.FLEET_API_TOKEN,'fleet-secret');
  assert.equal(mapped.JAMF_BASE_URL,'https://tenant.jamfcloud.com');
  assert.equal(mapped.JAMF_CLIENT_SECRET,'jamf-secret');
});

test('connector RPC proof uses a dedicated secret independent from envelope encryption',()=>{
  const proof=connectorRpcProof(RPC_ENV);
  assert.match(proof,/^[A-Za-z0-9_-]{43}$/);
  assert.equal(proof,connectorRpcProof({...RPC_ENV,UEM_SECRETS_ENCRYPTION_KEY:KEY}));
  assert.notEqual(proof,connectorRpcProof({UEM_CONNECTOR_RPC_SECRET:Buffer.alloc(32,12).toString('base64')}));
  assert.throws(()=>connectorRpcProof({UEM_SECRETS_ENCRYPTION_KEY:KEY}),/RPC proof is not configured/);
  assert.doesNotMatch(proof,/top-secret|fleet\.example/);
});

test('connector vault refuses missing or malformed encryption keys',()=>{
  const config={baseUrl:'https://fleet.example',apiToken:'12345678'};
  assert.throws(()=>sealConnectorConfig(config,WORKSPACE,'fleetdm',{}),/vault is not configured/);
  assert.throws(()=>connectorRpcProof({}),/RPC proof is not configured/);
  assert.throws(()=>sealConnectorConfig(config,WORKSPACE,'fleetdm',{UEM_SECRETS_ENCRYPTION_KEY:'short'}),/vault is not configured/);
});
