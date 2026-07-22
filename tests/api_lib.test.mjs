import test from 'node:test';
import assert from 'node:assert/strict';

const httpUrl = new URL('../api/_lib/http.js', import.meta.url);
const supabaseUrl = new URL('../api/_lib/supabase.js', import.meta.url);

function request({ method = 'GET', origin = 'https://app.example', host = 'app.example', body, cookies = '' } = {}) {
  return {
    method,
    headers: {
      origin,
      host,
      'x-forwarded-host': host,
      'x-forwarded-proto': 'https',
      cookie: cookies,
      'content-length': body === undefined ? '0' : String(Buffer.byteLength(JSON.stringify(body)))
    },
    body
  };
}

test('session cookies are HttpOnly, strict, bounded and secure in production', async () => {
  const { sessionCookies } = await import(httpUrl);
  const cookies = sessionCookies({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 }, true);
  assert.equal(cookies.length, 2);
  for (const cookie of cookies) {
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /Max-Age=\d+/);
  }
  assert.ok(cookies.some(cookie => cookie.startsWith('lf_access=')));
  assert.ok(cookies.some(cookie => cookie.startsWith('lf_refresh=')));
});

test('session cookies reject non-string, oversized and control-bearing tokens', async () => {
  const { sessionCookies } = await import(httpUrl);
  const invalid = [
    { access_token: 123, refresh_token: 'refresh' },
    { access_token: 'access', refresh_token: {} },
    { access_token: '', refresh_token: 'refresh' },
    { access_token: 'a'.repeat(16385), refresh_token: 'refresh' },
    { access_token: 'access\nheader', refresh_token: 'refresh' },
    { access_token: 'access', refresh_token: 'refresh\u007fvalue' }
  ];
  for (const session of invalid) assert.throws(() => sessionCookies(session, true), /invalid session/i);
});

test('mutations reject missing or cross-origin requests', async () => {
  const { assertSameOrigin } = await import(httpUrl);
  assert.doesNotThrow(() => assertSameOrigin(request({ method: 'POST' })));
  assert.throws(() => assertSameOrigin(request({ method: 'POST', origin: 'https://evil.example' })), /origin/i);
  assert.throws(() => assertSameOrigin(request({ method: 'POST', origin: '' })), /origin/i);
});

test('JSON body parser caps payload at one MiB', async () => {
  const { readJson } = await import(httpUrl);
  assert.deepEqual(readJson(request({ method: 'POST', body: { ok: true } })), { ok: true });
  const oversized = request({ method: 'POST', body: { value: 'x' } });
  oversized.headers['content-length'] = String(1024 * 1024 + 1);
  assert.throws(() => readJson(oversized), /1 MiB/);
});

test('runtime config refuses service-role or secret keys', async () => {
  const { readConfig } = await import(supabaseUrl);
  assert.throws(() => readConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' }), /secret/i);
  assert.throws(() => readConfig({ SUPABASE_URL: 'http://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' }), /https/i);
  const config = readConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' });
  assert.equal(config.url, 'https://project.supabase.co');
  assert.equal(config.key, 'sb_publishable_example');
});

test('Supabase PT409 conflicts become safe revision conflicts', async () => {
  const { createSupabaseClient } = await import(supabaseUrl);
  const client = createSupabaseClient(
    { url: 'https://project.supabase.co', key: 'sb_publishable_example' },
    async () => new Response(JSON.stringify({ code: 'PT409', message: 'workspace revision conflict', details: 'internal SQL details' }), {
      status: 409,
      headers: { 'content-type': 'application/json' }
    })
  );
  await assert.rejects(
    client.json('/rest/v1/rpc/save_workspace_state', { method: 'POST', body: {} }),
    error => error.status === 409 && error.code === 'revision_conflict' && !error.message.includes('internal SQL')
  );
});

test('Supabase server failures are generic and do not expose database details', async () => {
  const { createSupabaseClient } = await import(supabaseUrl);
  const client = createSupabaseClient(
    { url: 'https://project.supabase.co', key: 'sb_publishable_example' },
    async () => new Response(JSON.stringify({ code: '42P01', message: 'relation private_table does not exist', details: 'schema internals' }), {
      status: 500, headers: { 'content-type': 'application/json' }
    })
  );
  await assert.rejects(
    client.json('/rest/v1/workspaces'),
    error => error.status === 502 && error.code === 'cloud_unavailable' && !/private_table|schema internals/.test(error.message)
  );
});

test('Supabase 4xx failures do not expose auth or database internals', async () => {
  const { createSupabaseClient } = await import(supabaseUrl);
  const client = createSupabaseClient(
    { url: 'https://project.supabase.co', key: 'sb_publishable_example' },
    async () => new Response(JSON.stringify({ message: 'User already registered: auth.users constraint users_email_key' }), {
      status: 400, headers: { 'content-type': 'application/json' }
    })
  );
  await assert.rejects(
    client.json('/auth/v1/signup', { method: 'POST', body: {} }),
    error => error.status === 400 && error.code === 'cloud_request_rejected' && !/already registered|auth\.users|users_email_key/i.test(error.message)
  );
});

test('Supabase requests always use the configured public key and optional user JWT', async () => {
  const { createSupabaseClient } = await import(supabaseUrl);
  let captured;
  const client = createSupabaseClient(
    { url: 'https://project.supabase.co', key: 'sb_publishable_example' },
    async (url, options) => { captured = { url, options }; return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }); }
  );
  await client.request('/rest/v1/workspaces', { accessToken: 'user-jwt' });
  assert.equal(captured.url, 'https://project.supabase.co/rest/v1/workspaces');
  assert.equal(captured.options.headers.apikey, 'sb_publishable_example');
  assert.equal(captured.options.headers.authorization, 'Bearer user-jwt');
});
