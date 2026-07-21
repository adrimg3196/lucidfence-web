import test from 'node:test';
import assert from 'node:assert/strict';

function response() {
  const headers = new Map();
  return { statusCode: 0, headers, body: '', setHeader(n, v) { headers.set(n.toLowerCase(), v); }, end(v = '') { this.body = v; } };
}
function req() { return { method: 'GET', headers: {} }; }

test('runtime advertises cloud only when safe Supabase config exists', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_PUBLISHABLE_KEY, anon: process.env.SUPABASE_ANON_KEY };
  const { default: handler } = await import('../api/runtime.js');
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete process.env.SUPABASE_ANON_KEY;
    const local = response();
    await handler(req(), local);
    assert.equal(local.statusCode, 200);
    assert.deepEqual(JSON.parse(local.body), { cloud: false, mode: 'local-first' });

    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    const cloud = response();
    await handler(req(), cloud);
    assert.equal(cloud.statusCode, 200);
    assert.deepEqual(JSON.parse(cloud.body), { cloud: true, mode: 'central-saas', provider: 'supabase', session: 'httpOnly-cookie' });
    assert.doesNotMatch(cloud.body, /project\.supabase\.co|sb_publishable/i);
  } finally {
    if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url;
    if (previous.key === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = previous.key;
    if (previous.anon === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.anon;
  }
});
