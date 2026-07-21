import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('Vercel config serves the PWA and applies security headers', async () => {
  const config = JSON.parse(await read('vercel.json'));
  assert.ok(config.rewrites.some(rule => rule.source === '/' && rule.destination === '/index.html'));
  assert.ok(config.rewrites.some(rule => rule.source === '/runtime.json' && rule.destination === '/api/runtime'));
  const serialized = JSON.stringify(config);
  for (const header of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) {
    assert.ok(serialized.includes(header), `missing ${header}`);
  }
  assert.match(serialized, /connect-src 'self' https:/);
  assert.match(serialized, /Cache-Control/);
});

test('environment template contains placeholders only and never requests service role', async () => {
  const env = await read('.env.example');
  assert.match(env, /^SUPABASE_URL=/m);
  assert.match(env, /^SUPABASE_PUBLISHABLE_KEY=/m);
  assert.doesNotMatch(env, /SERVICE_ROLE|DATABASE_URL|JWT_SECRET/);
  assert.match(env, /\[REDACTED\]/);
});

test('cloud deployment guide keeps central and customer-owned infrastructure separate', async () => {
  const guide = await read('DEPLOY_CLOUD.md');
  for (const text of ['Infraestructura central', 'Infraestructura del cliente', 'supabase db push', 'Vercel Hobby', 'uso no comercial', 'RLS', 'HttpOnly']) {
    assert.ok(guide.includes(text), `guide missing ${text}`);
  }
});

test('CI runs cloud contracts without requiring credentials', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /SUPABASE_PUBLISHABLE_KEY:\s*[^\n]*sb_/);
});
