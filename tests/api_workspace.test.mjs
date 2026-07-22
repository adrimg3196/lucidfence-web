import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';

function req({ method = 'GET', body, query = {}, origin = 'https://app.example' } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return {
    method,
    query,
    body,
    headers: {
      origin,
      host: 'app.example',
      'x-forwarded-host': 'app.example',
      'x-forwarded-proto': 'https',
      cookie: 'lf_access=user-access; lf_refresh=user-refresh',
      'content-length': String(Buffer.byteLength(raw))
    }
  };
}

function response() {
  const headers = new Map();
  return { statusCode: 0, headers, body: '', setHeader(n, v) { headers.set(n.toLowerCase(), v); }, end(v = '') { this.body = v; } };
}
function data(res) { return JSON.parse(res.body); }

function userResponse() {
  return new Response(JSON.stringify({ id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('workspace listing uses the user JWT so Supabase RLS remains authoritative', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return userResponse();
    return new Response(JSON.stringify([{ role: 'owner', workspace: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', slug: 'acme-1234' } }]), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/index.js');
    const res = response();
    await handler(req(), res);
    assert.equal(res.statusCode, 200);
    assert.equal(data(res).workspaces[0].role, 'owner');
    const databaseCall = calls[1];
    assert.match(databaseCall.url, /\/rest\/v1\/workspace_members\?/);
    assert.equal(databaseCall.options.headers.authorization, 'Bearer user-access');
    assert.doesNotMatch(JSON.stringify(databaseCall.options.headers), /service_role|sb_secret_/i);
  } finally { globalThis.fetch = originalFetch; }
});

test('workspace creation delegates ownership to the authenticated RPC', async () => {
  const originalFetch = globalThis.fetch;
  let rpc;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    rpc = { url, options };
    return new Response(JSON.stringify({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: 'Acme', slug: 'acme-1234' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/index.js');
    const res = response();
    await handler(req({ method: 'POST', body: { name: 'Acme' } }), res);
    assert.equal(res.statusCode, 201);
    assert.equal(rpc.url, 'https://project.supabase.co/rest/v1/rpc/create_workspace');
    assert.deepEqual(JSON.parse(rpc.options.body), { workspace_name: 'Acme' });
    assert.equal(rpc.options.headers.authorization, 'Bearer user-access');
  } finally { globalThis.fetch = originalFetch; }
});

test('cloud sync saves through the revision-checked RPC', async () => {
  const originalFetch = globalThis.fetch;
  let rpc;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    rpc = { url, options };
    return new Response(JSON.stringify({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payload: { goals: [] }, revision: 4 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/state.js');
    const res = response();
    await handler(req({ method: 'PUT', body: { workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 3, state: { goals: [] } } }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(rpc.url, 'https://project.supabase.co/rest/v1/rpc/save_workspace_state');
    assert.deepEqual(JSON.parse(rpc.options.body), {
      target_workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expected_revision: 3, new_payload: { goals: [] }
    });
    assert.equal(rpc.options.headers.authorization, 'Bearer user-access');
  } finally { globalThis.fetch = originalFetch; }
});

test('cloud sync rejects secrets before any database write', async () => {
  const originalFetch = globalThis.fetch;
  let databaseWrites = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    databaseWrites += 1;
    return new Response('{}', { status: 200 });
  };
  try {
    const { default: handler } = await import('../api/workspaces/state.js');
    const res = response();
    await handler(req({ method: 'PUT', body: {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 1,
      state: { settings: { api_key: 'must-not-be-stored' } }
    } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(data(res).error, 'secret_field_rejected');
    assert.equal(databaseWrites, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('state read validates workspace ids before contacting the database', async () => {
  const originalFetch = globalThis.fetch;
  let databaseCalls = 0;
  globalThis.fetch = async (url) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    databaseCalls += 1;
    return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/state.js');
    const res = response();
    await handler(req({ query: { workspaceId: 'not-a-uuid' } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(databaseCalls, 0);
  } finally { globalThis.fetch = originalFetch; }
});
