import test from 'node:test';
import assert from 'node:assert/strict';

const BASE_ENV = Object.freeze({
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example',
  GOOGLE_SSO_ENABLED: 'true',
  OAUTH_COOKIE_SECRET: 'test-only-cookie-secret-at-least-32-bytes-long',
  APP_ORIGIN: 'https://app.example'
});

function setEnv(overrides = {}) {
  for (const name of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY', 'GOOGLE_SSO_ENABLED', 'OAUTH_COOKIE_SECRET', 'APP_ORIGIN', 'VERCEL_URL']) delete process.env[name];
  Object.assign(process.env, BASE_ENV, overrides);
}

function request(url, { method = 'GET', cookie = '', host = 'attacker.example' } = {}) {
  return { method, url, headers: { cookie, host, 'x-forwarded-host': host, 'x-forwarded-proto': 'http' } };
}

function response() {
  const headers = new Map();
  return {
    statusCode: 0,
    body: '',
    setHeader(name, value) { headers.set(String(name).toLowerCase(), value); },
    end(value = '') { this.body = String(value); },
    headers
  };
}

function cookiePair(setCookie, name = 'lf_oauth_flow') {
  const values = Array.isArray(setCookie) ? setCookie : [setCookie];
  const selected = values.find(value => String(value).startsWith(`${name}=`));
  return String(selected).split(';', 1)[0];
}

function flowFromStart(res) {
  const location = new URL(res.headers.get('location'));
  const redirectTo = new URL(location.searchParams.get('redirect_to'));
  return {
    flowId: redirectTo.searchParams.get('flow'),
    flowCookie: cookiePair(res.headers.get('set-cookie')),
    location,
    redirectTo
  };
}

function simulateGoTruePkceRedirect(authorizeUrl, authCode = 'provider-code') {
  // Contract checked against supabase/auth 76e2aace4899f71bfc6038c8a00c913936a4561e:
  // external.go creates/consumes its UUID state; verify.go prepPKCERedirectURL preserves
  // redirect_to's query and adds only the auth code.
  const authorize = new URL(authorizeUrl);
  assert.equal(authorize.searchParams.has('state'), false, 'LucidFence must not override GoTrue provider state');
  const upstreamProviderState = '11111111-1111-4111-8111-111111111111';
  assert.match(upstreamProviderState, /^[0-9a-f-]{36}$/);
  const finalCallback = new URL(authorize.searchParams.get('redirect_to'));
  finalCallback.searchParams.set('code', authCode);
  assert.equal(finalCallback.searchParams.has('state'), false, 'GoTrue internal state never reaches the app callback');
  return finalCallback;
}

async function startFlow(overrides = {}) {
  setEnv(overrides);
  const { default: start } = await import('../api/auth/oauth/start.js');
  const res = response();
  await start(request('/api/auth/oauth/start?provider=google'), res);
  return { res, ...flowFromStart(res) };
}

function assertClearsFlow(res) {
  const cookies = res.headers.get('set-cookie');
  const values = Array.isArray(cookies) ? cookies : [cookies];
  assert.ok(values.some(value => String(value).startsWith('lf_oauth_flow=') && String(value).includes('Max-Age=0')));
}

function assertGenericFailure(res) {
  assert.equal(res.statusCode, 303);
  assert.equal(res.headers.get('location'), '/?auth_error=sso_failed');
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
  assertClearsFlow(res);
  assert.doesNotMatch(`${res.body}${res.headers.get('location')}`, /code|state|verifier|provider internals/i);
}

test('providers exposes only Google when explicitly enabled and nothing when disabled', async () => {
  const { default: providers } = await import('../api/auth/oauth/providers.js');
  setEnv();
  let res = response();
  await providers(request('/api/auth/oauth/providers'), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(JSON.parse(res.body), { providers: [{ id: 'google', label: 'Google' }] });
  assert.doesNotMatch(res.body, /issuer|client|supabase/i);

  setEnv({ GOOGLE_SSO_ENABLED: 'false' });
  res = response();
  await providers(request('/api/auth/oauth/providers'), res);
  assert.deepEqual(JSON.parse(res.body), { providers: [] });
});

test('start creates bounded encrypted flow cookie and exact trusted-origin PKCE redirect', async () => {
  const { res, flowId, flowCookie, location, redirectTo } = await startFlow();
  assert.equal(res.statusCode, 303);
  assert.equal(location.origin + location.pathname, 'https://project.supabase.co/auth/v1/authorize');
  assert.equal(location.searchParams.get('provider'), 'google');
  assert.equal(redirectTo.origin + redirectTo.pathname, 'https://app.example/api/auth/oauth/callback');
  assert.deepEqual([...redirectTo.searchParams.keys()], ['flow']);
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.match(location.searchParams.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(flowId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(location.searchParams.has('state'), false);
  assert.ok(flowCookie.length > 80);
  assert.ok(flowCookie.length <= 4096);
  const setCookie = res.headers.get('set-cookie');
  for (const flag of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/api/auth/oauth']) assert.match(setCookie, new RegExp(flag));
  const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)?.[1]);
  assert.ok(maxAge > 0 && maxAge <= 300);
  assert.doesNotMatch(setCookie, /Domain=/i);
  assert.doesNotMatch(`${res.body}${location.href}`, /test-only-cookie-secret|code_verifier|verifier/i);
});

test('start never derives callback origin from Host or forwarded headers', async () => {
  setEnv({ APP_ORIGIN: '', VERCEL_URL: 'trusted-deploy.vercel.app' });
  const { default: start } = await import('../api/auth/oauth/start.js');
  const res = response();
  await start(request('/api/auth/oauth/start?provider=google', { host: 'poison.example' }), res);
  const location = new URL(res.headers.get('location'));
  const redirectTo = new URL(location.searchParams.get('redirect_to'));
  assert.equal(redirectTo.origin + redirectTo.pathname, 'https://trusted-deploy.vercel.app/api/auth/oauth/callback');
  assert.doesNotMatch(location.href, /poison|attacker/);
});

test('start rejects every non-canonical deployment origin', async () => {
  const { default: start } = await import('../api/auth/oauth/start.js');
  for (const origin of [
    'http://app.example', 'https://app.example:443', 'https://app.example:8443',
    'https://app.example.', 'https://user@app.example', 'https://app.example/',
    'https://app.example/path', 'https://app.example/%2e', 'https://app.example?x=1',
    'https://app.example#fragment'
  ]) {
    setEnv({ APP_ORIGIN: origin });
    const res = response();
    await start(request('/api/auth/oauth/start?provider=google'), res);
    assert.equal(res.statusCode, 500, `${origin} returned ${res.statusCode}`);
    assert.equal(res.headers.has('location'), false);
  }
});

test('start rejects disabled, unknown, duplicated provider and unapproved return destinations', async () => {
  const { default: start } = await import('../api/auth/oauth/start.js');
  for (const [url, overrides] of [
    ['/api/auth/oauth/start?provider=google', { GOOGLE_SSO_ENABLED: 'false' }],
    ['/api/auth/oauth/start?provider=github', {}],
    ['/api/auth/oauth/start?provider=google&provider=google', {}],
    ['/api/auth/oauth/start?provider=google&return=https://evil.example', {}]
  ]) {
    setEnv(overrides);
    const res = response();
    await start(request(url), res);
    assert.ok([400, 404, 503].includes(res.statusCode), `${url} returned ${res.statusCode}`);
    assert.equal(res.headers.has('location'), false);
  }
});

test('GoTrue keeps its UUID state upstream and redirects only LucidFence flow plus code', async () => {
  const { res: startResponse, flowId, flowCookie } = await startFlow();
  const callbackUrl = simulateGoTruePkceRedirect(startResponse.headers.get('location'));
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({
      access_token: 'oauth-access-secret', refresh_token: 'oauth-refresh-secret', expires_in: 3600,
      user: { id: '44444444-4444-4444-8444-444444444444', email: 'sso@example.com' }
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: callback } = await import('../api/auth/oauth/callback.js');
    const res = response();
    await callback(request(`${callbackUrl.pathname}${callbackUrl.search}`, { cookie: flowCookie }), res);
    assert.equal(res.statusCode, 303);
    assert.equal(res.headers.get('location'), '/');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://project.supabase.co/auth/v1/token?grant_type=pkce');
    const body = JSON.parse(calls[0].options.body);
    assert.deepEqual(Object.keys(body).sort(), ['auth_code', 'code_verifier']);
    assert.equal(body.auth_code, 'provider-code');
    assert.match(body.code_verifier, /^[A-Za-z0-9_-]{43,128}$/);
    const cookies = res.headers.get('set-cookie');
    assert.equal(cookies.length, 3);
    assertClearsFlow(res);
    assert.ok(cookies.some(value => value.startsWith('lf_access=') && value.includes('HttpOnly')));
    assert.ok(cookies.some(value => value.startsWith('lf_refresh=') && value.includes('HttpOnly')));
    assert.doesNotMatch(`${res.body}${res.headers.get('location')}`, /provider-code|oauth-access-secret|oauth-refresh-secret|code_verifier/);
    assert.equal(callbackUrl.searchParams.get('flow'), flowId);
    assert.deepEqual([...callbackUrl.searchParams.keys()].sort(), ['code', 'flow']);
  } finally { globalThis.fetch = originalFetch; }
});

test('callback rejects duplicate params and code plus error without exchange, always clearing flow', async () => {
  const { flowId, flowCookie } = await startFlow();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; throw new Error('must not exchange'); };
  try {
    const { default: callback } = await import('../api/auth/oauth/callback.js');
    const queries = [
      `code=a&code=b&flow=${flowId}`,
      `code=a&flow=${flowId}&flow=${flowId}`,
      `error=denied&error=again&flow=${flowId}`,
      `code=a&error=denied&flow=${flowId}`,
      `code=a&flow=${flowId}&state=provider-state`,
      `code=a&flow=${flowId}&unexpected=value`
    ];
    for (const query of queries) {
      const res = response();
      await callback(request(`/api/auth/oauth/callback?${query}`, { cookie: flowCookie }), res);
      assertGenericFailure(res);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('callback returns a real 405 and clears the flow cookie for non-GET methods', async () => {
  setEnv();
  const { default: callback } = await import('../api/auth/oauth/callback.js');
  const res = response();
  await callback(request('/api/auth/oauth/callback?flow=x&code=y', { method: 'POST', cookie: 'lf_oauth_flow=secret' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers.has('location'), false);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assertClearsFlow(res);
  assert.doesNotMatch(res.body, /secret|flow=x|code=y/);
});

test('encrypted OAuth envelope is canonical, bounded and has an exact validated shape', async () => {
  setEnv();
  const { createOAuthFlow, openOAuthFlow, sealOAuthFlow } = await import('../api/_lib/oauth.js');
  const generated = createOAuthFlow(1234);
  const valid = { flowId: generated.flowId, codeVerifier: generated.codeVerifier, issuedAt: 1234, returnTo: 'home' };
  assert.deepEqual(openOAuthFlow(sealOAuthFlow(valid)), valid);
  const invalidFlows = [
    { ...valid, extra: true },
    { ...valid, flowId: 'x'.repeat(42) },
    { ...valid, flowId: `${'x'.repeat(42)}=` },
    { ...valid, codeVerifier: 'x'.repeat(42) },
    { ...valid, codeVerifier: 'x'.repeat(129) },
    { ...valid, codeVerifier: `${'x'.repeat(42)}!` },
    { ...valid, issuedAt: 1234.5 },
    { ...valid, returnTo: 'https://evil.example' }
  ];
  for (const flow of invalidFlows) assert.throws(() => openOAuthFlow(sealOAuthFlow(flow)), /invalid/i);
  assert.throws(() => openOAuthFlow('a'.repeat(4097)), /invalid/i);
  assert.throws(() => openOAuthFlow('AAAAAAAAAAAAAAAA.!!!!.AAAAAAAAAAAAAAAAAAAAAA'), /invalid/i);
});

test('callback rejects flow mismatch, tamper, expiry, provider error and replay with generic redirects', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response('{}', { status: 500 }); };
  try {
    const { default: callback } = await import('../api/auth/oauth/callback.js');
    const { sealOAuthFlow } = await import('../api/_lib/oauth.js');
    const fresh = await startFlow();
    const [cookieName, encodedEnvelope] = fresh.flowCookie.split('=');
    const envelopeParts = decodeURIComponent(encodedEnvelope).split('.');
    envelopeParts[1] = `${envelopeParts[1][0] === 'a' ? 'b' : 'a'}${envelopeParts[1].slice(1)}`;
    const tampered = `${cookieName}=${encodeURIComponent(envelopeParts.join('.'))}`;
    const expiredValue = sealOAuthFlow({ flowId: fresh.flowId, codeVerifier: 'v'.repeat(64), issuedAt: Date.now() - 301000, returnTo: 'home' }, process.env);
    const cases = [
      [`code=a&flow=${'x'.repeat(43)}`, fresh.flowCookie],
      [`code=a&flow=${fresh.flowId}`, tampered],
      [`code=a&flow=${fresh.flowId}`, `lf_oauth_flow=${encodeURIComponent(expiredValue)}`],
      [`error=access_denied&error_description=provider+internals&flow=${fresh.flowId}`, fresh.flowCookie],
      [`code=a&flow=${fresh.flowId}`, 'lf_oauth_flow=']
    ];
    for (const [query, cookie] of cases) {
      const res = response();
      await callback(request(`/api/auth/oauth/callback?${query}`, { cookie }), res);
      assertGenericFailure(res);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('callback clears the one-time browser flow after a failed Supabase exchange and does not retry', async () => {
  const { flowId, flowCookie } = await startFlow();
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return new Response(JSON.stringify({ message: 'provider internals' }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  try {
    const { default: callback } = await import('../api/auth/oauth/callback.js');
    const res = response();
    await callback(request(`/api/auth/oauth/callback?code=bad&flow=${flowId}`, { cookie: flowCookie }), res);
    assertGenericFailure(res);
    assert.equal(calls, 1);
  } finally { globalThis.fetch = originalFetch; }
});
