import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readMigration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
async function migrations(){return ((await readMigration('202607220002_workspace_uem_connectors.sql'))+'\n'+(await readMigration('202607220003_connector_server_proof.sql'))+'\n'+(await readMigration('202607220004_exact_connector_envelope.sql'))+'\n'+(await readMigration('202607220005_fix_connector_upsert_conflict.sql'))).toLowerCase();}
async function proofMigration(){return (await readMigration('202607220003_connector_server_proof.sql')).toLowerCase();}
async function envelopeMigration(){return (await readMigration('202607220004_exact_connector_envelope.sql')).toLowerCase();}
async function upsertFixMigration(){return (await readMigration('202607220005_fix_connector_upsert_conflict.sql')).toLowerCase();}

test('connector schema stores only sealed workspace-bound envelopes with forced RLS',async()=>{
  const sql=await migrations();
  assert.ok(sql.includes('create table public.workspace_uem_connectors'));
  assert.ok(sql.includes('sealed_config text not null'));
  assert.ok(sql.includes('alter table public.workspace_uem_connectors enable row level security'));
  assert.ok(sql.includes('alter table public.workspace_uem_connectors force row level security'));
  assert.ok(sql.includes('revoke all on public.workspace_uem_connectors from authenticated'));
  assert.doesNotMatch(sql,/api[_-]?token|client_secret|password\s+text/);
});

test('connector management RPCs enforce membership, roles and server proof',async()=>{
  const sql=await migrations(),proof=await proofMigration();
  assert.match(sql,/list_workspace_uem_connectors[\s\S]*is_workspace_member/);
  assert.match(proof,/load_workspace_uem_connector[\s\S]*can_write_workspace[\s\S]*verify_uem_connector_server_proof/);
  assert.match(proof,/upsert_workspace_uem_connector[\s\S]*m\.role in \('owner', 'admin'\)[\s\S]*verify_uem_connector_server_proof/);
  assert.match(proof,/delete_workspace_uem_connector[\s\S]*m\.role in \('owner', 'admin'\)[\s\S]*verify_uem_connector_server_proof/);
  assert.match(proof,/drop function public\.load_workspace_uem_connector\(uuid, text\)/);
  assert.match(proof,/drop function public\.upsert_workspace_uem_connector\(uuid, text, text, text\)/);
  assert.match(proof,/drop function public\.delete_workspace_uem_connector\(uuid, text\)/);
  assert.match(proof,/grant execute on function public\.load_workspace_uem_connector\(uuid, text, text\) to authenticated/);
  assert.match(proof,/revoke all on function public\.verify_uem_connector_server_proof\(text\) from public/);
  assert.doesNotMatch(proof,/grant execute on function public\.verify_uem_connector_server_proof/);
  const upsertFix=await upsertFixMigration();
  assert.match(upsertFix,/on conflict on constraint workspace_uem_connectors_pkey/);
  assert.match(upsertFix,/char_length\(connector_sealed_config\) <> 10966/);
});

test('server proof verifier stores only a fixed SHA-256 verifier, never a preimage',async()=>{
  const proof=await proofMigration();
  assert.match(proof,/extensions\.digest\([\s\S]*'sha256'/);
  assert.match(proof,/[a-f0-9]{64}/);
  assert.match(proof,/char_length\(connector_server_proof\) <> 43/);
  assert.doesNotMatch(proof,/uem_secrets_encryption_key|connector-rpc-proof:v1/);
});

test('connector SQL provider allowlist remains read-only and bounded',async()=>{
  const sql=await migrations(),envelope=await envelopeMigration();
  for(const provider of ['fleetdm','applivery','intune','jamf','custom-gateway'])assert.ok(sql.includes(`'${provider}'`));
  assert.match(envelope,/drop constraint workspace_uem_connectors_sealed_config_check/);
  assert.match(envelope,/char_length\(sealed_config\) = 10966/);
  assert.match(sql,/connector_provider = 'all'/);
  assert.doesNotMatch(sql,/wipe|erase|remote.?lock|factory.?reset|device.?command/);
});
