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

test('cloud sync preserves server-verified geofence results from UEM sync', async () => {
  const originalFetch = globalThis.fetch;
  let rpc;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    rpc = { url, options };
    return new Response(JSON.stringify({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payload: {}, revision: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/state.js');
    const res = response();
    const now = new Date().toISOString();
    await handler(req({ method: 'PUT', body: {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 1,
      state: {
        geofences: [{ id: 'hq', lat: 40.4168, lng: -3.7038, radiusM: 900 }],
        devices: [
          { id: 'fresh', provider: 'fleetdm', providerDeviceId: 'f1', providerSources: ['fleetdm'], lat: 40.4168, lng: -3.7038, observedAt: now, accuracyM: 10, compliant: true, risk: 'low', locationSource: 'fleetdm', locationAccuracy: 'precise_mdm', locationObservedAt: now, locationQuality: 'accepted', fenceState: 'inside', matchedFenceId: 'hq', readOnly: true }
        ]
      }
    } }), res);
    assert.equal(res.statusCode, 200);
    const saved = JSON.parse(rpc.options.body).new_payload.devices;
    assert.equal(saved[0].fenceState, 'inside');
    assert.equal(saved[0].matchedFenceId, 'hq');
    assert.equal(saved[0].locationQuality, 'accepted');
    assert.ok(saved.every(device => !device.locationRejectionReason || device.locationRejectionReason !== 'unverified_source'));
  } finally { globalThis.fetch = originalFetch; }
});

test('cloud sync never treats browser-provided coordinates as authoritative', async () => {
  const originalFetch = globalThis.fetch;
  let rpc;
  globalThis.fetch = async (url, options) => {
    if (url.endsWith('/auth/v1/user')) return userResponse();
    rpc = { url, options };
    return new Response(JSON.stringify({ workspace_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', payload: {}, revision: 2 }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/workspaces/state.js');
    const res = response();
    const now = new Date().toISOString();
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await handler(req({ method: 'PUT', body: {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 1,
      state: {
        geofences: [{ id: 'hq', lat: 40.4168, lng: -3.7038, radiusM: 900 }],
        devices: [
          { id: 'fresh', lat: 40.4168, lng: -3.7038, observedAt: now, accuracyM: 10, fenceState: 'outside' },
          { id: 'stale', lat: 40.5, lng: -3.8, observedAt: stale, accuracyM: 10, fenceState: 'outside' },
          { id: 'imprecise', lat: 40.5, lng: -3.8, observedAt: now, accuracyM: 900, fenceState: 'outside' }
        ]
      }
    } }), res);
    assert.equal(res.statusCode, 200);
    const saved = JSON.parse(rpc.options.body).new_payload.devices;
    assert.deepEqual(saved.map(device => [device.id, device.fenceState, device.matchedFenceId]), [
      ['fresh', 'inside', 'hq'], ['stale', 'unknown', null], ['imprecise', 'unknown', null]
    ]);
    assert.ok(saved.find(device => device.id === 'fresh').locationQuality === 'accepted');
    assert.ok(saved.filter(device => device.id !== 'fresh').every(device => device.locationRejectionReason && device.locationRejectionReason !== 'unverified_source'));
  } finally { globalThis.fetch = originalFetch; }
});

test('workspace mutations authenticate before parsing or geofence evaluation', async () => {
  const { default: handler } = await import('../api/workspaces/state.js');
  const request = req({ method: 'PUT', body: {
    workspaceId: 'not-a-uuid', expectedRevision: 1,
    state: { devices: Array.from({ length: 10000 }, (_, id) => ({ id })), geofences: Array.from({ length: 10000 }, (_, id) => ({ id })) }
  } });
  request.headers.cookie = '';
  const res = response();
  await handler(request, res);
  assert.equal(res.statusCode, 401);
  assert.equal(data(res).error, 'authentication_required');
});

test('cloud sync rejects excessive geofence work before database write', async () => {
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
    const observedAt = new Date().toISOString();
    await handler(req({ method: 'PUT', body: {
      workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 1,
      state: {
        devices: Array.from({ length: 1001 }, (_, id) => ({ id: String(id), lat: 1, lng: 1, observedAt, accuracyM: 1 })),
        geofences: Array.from({ length: 251 }, (_, id) => ({ id: String(id), lat: 1, lng: 1, radiusM: 10 }))
      }
    } }), res);
    assert.equal(res.statusCode, 400);
    assert.equal(data(res).error, 'geofence_work_limit_exceeded');
    assert.equal(databaseWrites, 0);
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
