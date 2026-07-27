import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migrationUrl = new URL('../supabase/migrations/202607210001_initial.sql', import.meta.url);
const conflictMigrationUrl = new URL('../supabase/migrations/202607220001_revision_conflict_status.sql', import.meta.url);
const functionAclMigrationUrl = new URL('../supabase/migrations/202607270001_lock_down_function_acl.sql', import.meta.url);
const internalFunctionAclMigrationUrl = new URL('../supabase/migrations/202607270002_lock_down_internal_function_acl.sql', import.meta.url);

async function migration() {
  return readFile(migrationUrl, 'utf8');
}

test('schema defines tenant-owned workspaces and versioned state', async () => {
  const sql = await migration();
  for (const fragment of [
    'create table public.workspaces',
    'create table public.workspace_members',
    'create table public.workspace_state',
    'payload jsonb not null',
    'revision bigint not null',
    'updated_by uuid not null'
  ]) assert.ok(sql.toLowerCase().includes(fragment), `missing ${fragment}`);
});

test('every tenant table enables row level security', async () => {
  const sql = (await migration()).toLowerCase();
  for (const table of ['workspaces', 'workspace_members', 'workspace_state']) {
    assert.ok(sql.includes(`alter table public.${table} enable row level security`), `RLS missing for ${table}`);
    assert.ok(sql.includes(`alter table public.${table} force row level security`), `forced RLS missing for ${table}`);
  }
});

test('membership helper and policies bind access to auth.uid()', async () => {
  const sql = (await migration()).toLowerCase();
  assert.ok(sql.includes('function public.is_workspace_member'));
  assert.ok(sql.includes('auth.uid()'));
  assert.ok(sql.includes('security definer'));
  assert.ok(sql.includes("set search_path = ''"));
  assert.ok(sql.includes('using (public.is_workspace_member(id))'));
  assert.ok(sql.includes('using (public.is_workspace_member(workspace_id))'));
  assert.doesNotMatch(sql, /on public\.workspace_state for (insert|update)/);
});

test('workspace creation is atomic and cannot choose another owner', async () => {
  const sql = (await migration()).toLowerCase();
  assert.ok(sql.includes('function public.create_workspace(workspace_name text)'));
  assert.match(sql, /insert into public\.workspaces[\s\S]*auth\.uid\(\)/);
  assert.match(sql, /insert into public\.workspace_members[\s\S]*auth\.uid\(\)[\s\S]*'owner'/);
  assert.match(sql, /count\(\*\)[\s\S]*workspace_members[\s\S]*>= 20/);
  assert.ok(sql.includes('revoke all on function public.create_workspace(text) from public'));
  assert.ok(sql.includes('grant execute on function public.create_workspace(text) to authenticated'));
});

test('state writes use an optimistic-lock RPC with a payload cap', async () => {
  const sql = (await migration()).toLowerCase();
  assert.ok(sql.includes('function public.save_workspace_state(target_workspace_id uuid, expected_revision bigint, new_payload jsonb)'));
  assert.ok(sql.includes('public.can_write_workspace(target_workspace_id)'));
  assert.ok(sql.includes("jsonb_typeof(new_payload) <> 'object'"));
  assert.ok(sql.includes('octet_length(new_payload::text) > 1048576'));
  assert.match(sql, /where workspace_id = target_workspace_id[\s\S]*and revision = expected_revision/);
  assert.ok(sql.includes("errcode = '40001'"));
  assert.ok(sql.includes('grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated'));
  assert.ok(sql.includes('grant select on public.workspace_state to authenticated'));
  assert.doesNotMatch(sql, /grant select, insert, update on public\.workspace_state/);
});

test('revision conflicts use an immediate PostgREST PT409 status', async () => {
  const sql = (await readFile(conflictMigrationUrl, 'utf8')).toLowerCase();
  assert.ok(sql.includes('create or replace function public.save_workspace_state'));
  assert.ok(sql.includes("raise sqlstate 'pt409'"));
  assert.doesNotMatch(sql, /40001/);
});

test('anonymous role has no direct tenant table privileges', async () => {
  const sql = (await migration()).toLowerCase();
  assert.ok(sql.includes('revoke all on public.workspaces from anon'));
  assert.ok(sql.includes('revoke all on public.workspace_members from anon'));
  assert.ok(sql.includes('revoke all on public.workspace_state from anon'));
});

test('function ACL migration removes default public and anon execution', async () => {
  const sql = (await readFile(functionAclMigrationUrl, 'utf8')).toLowerCase();
  assert.ok(sql.includes('alter default privileges in schema public revoke execute on functions from public'));
  assert.ok(sql.includes('revoke execute on all functions in schema public from public, anon'));
  assert.ok(sql.includes('grant execute on function public.create_workspace(text) to authenticated'));
  assert.ok(sql.includes('grant execute on function public.save_workspace_state(uuid, bigint, jsonb) to authenticated'));
  assert.ok(sql.includes('grant execute on function public.list_workspace_uem_connectors(uuid) to authenticated'));
  assert.ok(sql.includes('grant execute on function public.load_workspace_uem_connector(uuid, text, text) to authenticated'));
  assert.ok(sql.includes('grant execute on function public.upsert_workspace_uem_connector(uuid, text, text, text, text) to authenticated'));
  assert.ok(sql.includes('grant execute on function public.delete_workspace_uem_connector(uuid, text, text) to authenticated'));
  assert.doesNotMatch(sql, /grant execute on function public\.(?:verify_uem_connector_server_proof|rls_auto_enable)/);
});

test('internal function ACL migration revokes authenticated execution explicitly', async () => {
  const sql = (await readFile(internalFunctionAclMigrationUrl, 'utf8')).toLowerCase();
  assert.ok(sql.includes('revoke execute on function public.verify_uem_connector_server_proof(text) from authenticated'));
  assert.ok(sql.includes('revoke execute on function public.rls_auto_enable() from authenticated'));
});
