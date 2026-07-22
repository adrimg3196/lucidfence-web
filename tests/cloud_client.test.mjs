import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const moduleUrl = new URL('../web-cloud.js', import.meta.url);
await import(moduleUrl);
const Cloud = globalThis.LucidFenceCloud;

test('cloud detection stays local without a network request while offline', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  let calls = 0;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    const cloud = Cloud.create(async () => { calls += 1; throw new Error('network should not be used'); });
    assert.equal(await cloud.detect(), false);
    assert.equal(calls, 0);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'navigator', descriptor);
    else delete globalThis.navigator;
  }
});

test('cloud detection prefers the dynamic API runtime over the static fallback', async () => {
  const calls = [];
  const cloud = Cloud.create(async (url) => {
    calls.push(url);
    if (url === '/api/runtime') return new Response(JSON.stringify({ cloud: true, mode: 'central-saas' }), { status: 200 });
    if (url === '/runtime.json') return new Response(JSON.stringify({ cloud: false, mode: 'local-first' }), { status: 200 });
    return new Response('not found', { status: 404 });
  });
  assert.equal(await cloud.detect(), true);
  assert.deepEqual(calls, ['/api/runtime']);
});

test('cloud detection fails open to local mode when the API is absent', async () => {
  const cloud = Cloud.create(async () => new Response('not found', { status: 404 }));
  assert.equal(await cloud.detect(), false);
  assert.equal(cloud.status().available, false);
});

test('login uses same-origin credentials and never returns or stores tokens', async () => {
  let captured;
  const cloud = Cloud.create(async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ user: { id: 'user-1', email: 'owner@example.com' } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const user = await cloud.login('OWNER@example.com', 'correct-password');
  assert.equal(user.email, 'owner@example.com');
  assert.equal(captured.url, '/api/auth/login');
  assert.equal(captured.options.credentials, 'include');
  assert.deepEqual(JSON.parse(captured.options.body), { email: 'owner@example.com', password: 'correct-password' });
  const source = await readFile(moduleUrl, 'utf8');
  assert.doesNotMatch(source, /localStorage|sessionStorage|access_token|refresh_token/);
});

test('OAuth providers are discovered through the same-origin BFF', async () => {
  const calls = [];
  const cloud = Cloud.create(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ providers: [{ id: 'google', label: 'Google' }] }), { status: 200 });
  });
  const providers = await cloud.oauthProviders();
  assert.deepEqual(providers, [{ id: 'google', label: 'Google' }]);
  assert.equal(calls[0].url, '/api/auth/oauth/providers');
  assert.equal(calls[0].options.credentials, 'include');
});

test('OAuth callback error is generic and removed from browser history', () => {
  let replacement = '';
  const location = { href: 'https://app.example/?keep=yes&auth_error=sso_failed&code=secret&state=secret&flow=secret&error=denied&error_description=private#connect' };
  const history = { replaceState(_state, _title, value) { replacement = value; } };
  assert.equal(Cloud.consumeAuthError(location, history), true);
  assert.equal(replacement, '/?keep=yes#connect');
  assert.doesNotMatch(replacement, /auth_error|code|state|flow|error|error_description|secret|private/);
  assert.equal(Cloud.consumeAuthError({ href: 'https://app.example/?auth_error=unexpected' }, history), false);
});

test('workspace pull and push track the server revision', async () => {
  const calls = [];
  const cloud = Cloud.create(async (url, options) => {
    calls.push({ url, options });
    if (options.method === 'GET') return new Response(JSON.stringify({ state: { payload: { goals: [{ id: 'g1' }] }, revision: 7 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify({ state: { payload: { goals: [{ id: 'g1' }] }, revision: 8 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  });
  const pulled = await cloud.pull('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(pulled.revision, 7);
  const pushed = await cloud.push('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { goals: [{ id: 'g1' }] });
  assert.equal(pushed.revision, 8);
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    workspaceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedRevision: 7, state: { goals: [{ id: 'g1' }] }
  });
});

test('cloud errors expose safe codes for UI decisions', async () => {
  const cloud = Cloud.create(async (_url, options) => {
    if ((options.method || 'GET') === 'GET') {
      return new Response(JSON.stringify({ state: { payload: {}, revision: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'revision_conflict', message: 'Cloud state changed' }), { status: 409, headers: { 'content-type': 'application/json' } });
  });
  await cloud.pull('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  await assert.rejects(cloud.push('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', {}), error => error.code === 'revision_conflict' && error.status === 409);
});

test('switching back to a workspace requires a fresh pull before push', async () => {
  const calls = [];
  const cloud = Cloud.create(async (url, options) => {
    calls.push({ url, options });
    if ((options.method || 'GET') === 'GET') {
      const id = new URL(url, 'https://app.example').searchParams.get('workspaceId');
      return new Response(JSON.stringify({ state: { workspace_id: id, payload: { id }, revision: 3 } }), { status: 200 });
    }
    return new Response(JSON.stringify({ state: { revision: 4 } }), { status: 200 });
  });
  await cloud.pull('workspace-a');
  await cloud.pull('workspace-b');
  cloud.invalidate('workspace-a');
  await assert.rejects(cloud.push('workspace-a', { from: 'workspace-b' }), error => error.code === 'revision_required');
  assert.equal(calls.filter(call => call.options.method === 'PUT').length, 0);
  assert.equal(cloud.canPush('workspace-a'), false);
  assert.equal(cloud.canPush('workspace-b'), true);
});
