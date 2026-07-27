import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';

function req(body, overrides = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  return {
    method: overrides.method || 'POST',
    headers: {
      origin: overrides.origin === undefined ? 'https://app.example' : overrides.origin,
      host: 'app.example',
      'x-forwarded-host': 'app.example',
      'x-forwarded-proto': 'https',
      'content-length': String(Buffer.byteLength(raw)),
      cookie: overrides.cookie || ''
    },
    body
  };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value = '') { this.body = value; },
    headers,
    body: ''
  };
}

function json(res) { return JSON.parse(res.body); }

test('login exchanges credentials server-side and returns only HttpOnly cookies', async () => {
  const originalFetch = globalThis.fetch;
  let captured;
  globalThis.fetch = async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({
      access_token: 'access-secret', refresh_token: 'refresh-secret', expires_in: 3600,
      user: { id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: handler } = await import('../api/auth/login.js');
    const res = response();
    await handler(req({ email: 'owner@example.com', password: 'correct-password' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(captured.url, 'https://project.supabase.co/auth/v1/token?grant_type=password');
    assert.equal(JSON.parse(captured.options.body).email, 'owner@example.com');
    const cookies = res.headers.get('set-cookie');
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every(value => value.includes('HttpOnly')));
    assert.doesNotMatch(res.body, /access-secret|refresh-secret/);
    assert.deepEqual(json(res).user, { id: '11111111-1111-1111-1111-111111111111', email: 'owner@example.com' });
  } finally { globalThis.fetch = originalFetch; }
});

test('login applies bounded application-owned throttling without storing raw email', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: 'invalid' }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { resetLoginRateLimitForTests, loginRateLimitDebugKeys } = await import('../api/_lib/rate-limit.js');
    resetLoginRateLimitForTests();
    const { default: handler } = await import('../api/auth/login.js');
    let last;
    for (let attempt = 0; attempt < 6; attempt += 1) {
      last = response();
      const request = req({ email: 'target@example.com', password: 'wrong-password' });
      request.headers['x-vercel-forwarded-for'] = '203.0.113.90';
      await handler(request, last);
    }
    assert.equal(last.statusCode, 429);
    assert.equal(json(last).error, 'login_rate_limited');
    assert.equal(calls, 5);
    assert.ok(last.headers.get('retry-after'));
    assert.ok(loginRateLimitDebugKeys().every(key => !key.includes('target@example.com')));
    assert.ok(loginRateLimitDebugKeys().length <= 4096);
  } finally { globalThis.fetch = originalFetch; }
});

test('login rejects cross-origin requests before contacting Supabase', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}'); };
  try {
    const { default: handler } = await import('../api/auth/login.js');
    const res = response();
    await handler(req({ email: 'owner@example.com', password: 'correct-password' }, { origin: 'https://evil.example' }), res);
    assert.equal(res.statusCode, 403);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('signup never returns provider tokens to the browser', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    access_token: 'signup-access', refresh_token: 'signup-refresh', expires_in: 3600,
    user: { id: '22222222-2222-2222-2222-222222222222', email: 'new@example.com' }
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const { default: handler } = await import('../api/auth/signup.js');
    const res = response();
    await handler(req({ email: 'new@example.com', password: 'a-strong-password' }), res);
    assert.equal(res.statusCode, 201);
    assert.doesNotMatch(res.body, /signup-access|signup-refresh/);
    assert.equal(json(res).confirmationRequired, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('me refreshes an expired access token without exposing tokens', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user') && options.headers.authorization === 'Bearer expired') {
      return new Response(JSON.stringify({ message: 'expired' }), { status: 401, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/auth/v1/token?grant_type=refresh_token')) {
      return new Response(JSON.stringify({ access_token: 'renewed-access', refresh_token: 'renewed-refresh', expires_in: 3600 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.endsWith('/auth/v1/user') && options.headers.authorization === 'Bearer renewed-access') {
      return new Response(JSON.stringify({ id: '33333333-3333-3333-3333-333333333333', email: 'owner@example.com' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response('{}', { status: 500 });
  };
  try {
    const { default: handler } = await import('../api/auth/me.js');
    const res = response();
    await handler(req(undefined, { method: 'GET', cookie: 'lf_access=expired; lf_refresh=refresh-token' }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(json(res).user.email, 'owner@example.com');
    assert.doesNotMatch(res.body, /renewed-access|renewed-refresh/);
    assert.equal(res.headers.get('set-cookie').length, 2);
    assert.equal(calls.length, 3);
  } finally { globalThis.fetch = originalFetch; }
});

test('temporary refresh outages preserve the refresh cookie and return 502', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const payload = String(url).includes('/auth/v1/user') ? { message: 'expired' } : { message: 'provider internals' };
    const status = String(url).includes('/auth/v1/user') ? 401 : 503;
    return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: me } = await import('../api/auth/me.js');
    const res = response();
    await me(req(undefined, { method: 'GET', cookie: 'lf_access=expired; lf_refresh=keep-me' }), res);
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).error, 'cloud_unavailable');
    assert.equal(res.headers.has('Set-Cookie'), false);
  } finally { globalThis.fetch = originalFetch; }
});

test('me returns 401 and clears cookies when no session exists', async () => {
  const { default: handler } = await import('../api/auth/me.js');
  const res = response();
  await handler(req(undefined, { method: 'GET' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(json(res).error, 'authentication_required');
  assert.ok(res.headers.get('set-cookie').every(value => value.includes('Max-Age=0')));
});

test('logout clears both cookies even when provider logout is unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('provider offline'); };
  try {
    const { default: handler } = await import('../api/auth/logout.js');
    const res = response();
    await handler(req({}, { cookie: 'lf_access=token; lf_refresh=refresh' }), res);
    assert.equal(res.statusCode, 200);
    const cookies = res.headers.get('set-cookie');
    assert.equal(cookies.length, 2);
    assert.ok(cookies.every(value => value.includes('Max-Age=0')));
  } finally { globalThis.fetch = originalFetch; }
});
