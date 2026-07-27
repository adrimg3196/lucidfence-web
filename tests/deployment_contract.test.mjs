import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('Vercel config serves the PWA and applies security headers', async () => {
  const config = JSON.parse(await read('vercel.json'));
  assert.ok(config.rewrites.some(rule => rule.source === '/api/uem/connectors' && rule.destination === '/api/uem?resource=connectors'));
  assert.ok(config.rewrites.some(rule => rule.source === '/' && rule.destination === '/index.html'));
  assert.ok(config.rewrites.some(rule => rule.source === '/runtime.json' && rule.destination === '/api/runtime'));
  const serialized = JSON.stringify(config);
  for (const header of ['Content-Security-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy']) assert.ok(serialized.includes(header));
  assert.match(serialized, /connect-src 'self' https:/);
  assert.match(serialized, /Cache-Control/);
  assert.ok(config.functions['api/**/*.js'].maxDuration >= 20);
});

test('environment template contains placeholders only and never requests service role', async () => {
  const env = await read('.env.example');
  assert.match(env, /^SUPABASE_URL=/m);
  assert.match(env, /^SUPABASE_PUBLISHABLE_KEY=/m);
  assert.match(env, /^GOOGLE_SSO_ENABLED=false$/m);
  assert.match(env, /^APP_ORIGIN=https:\/\//m);
  assert.match(env, /^OAUTH_COOKIE_SECRET=\[REDACTED\]$/m);
  assert.match(env, /^UEM_SECRETS_ENCRYPTION_KEY=\[REDACTED\]$/m);
  assert.doesNotMatch(env, /SERVICE_ROLE|DATABASE_URL|JWT_SECRET/);
  assert.match(env, /\[REDACTED\]/);
});

test('cloud deployment guide keeps central and customer-owned infrastructure separate', async () => {
  const guide = await read('DEPLOY_CLOUD.md');
  for (const text of ['Infraestructura central', 'Infraestructura del cliente', 'supabase db push', 'Vercel Hobby', 'uso no comercial', 'RLS', 'HttpOnly']) assert.ok(guide.includes(text));
});

test('cloud guide documents the exact Google and Supabase callback allowlists', async () => {
  const guide = await read('DEPLOY_CLOUD.md');
  assert.match(guide, /\$\{SUPABASE_URL\}\/auth\/v1\/callback/);
  assert.match(guide, /https:\/\/TU_DOMINIO\/api\/auth\/oauth\/callback/);
  assert.match(guide, /GOOGLE_SSO_ENABLED/);
  assert.match(guide, /OAUTH_COOKIE_SECRET/);
  assert.match(guide, /APP_ORIGIN/);
});

test('CI runs cloud contracts without requiring credentials', async () => {
  const workflow = await read('.github/workflows/ci.yml');
  assert.match(workflow, /npm test/);
  assert.doesNotMatch(workflow, /SUPABASE_PUBLISHABLE_KEY:\s*[^\n]*sb_/);
});

test('Docker BYOI serves an explicit static allowlist only', async () => {
  const dockerfile = await read('deploy/Dockerfile');
  const ignore = await read('.dockerignore');
  assert.doesNotMatch(dockerfile, /COPY[^\n]*\s\.\s+\/usr\/share\/nginx\/html/);
  for (const file of ['index.html', 'web-core.js', 'web-cloud.js', 'web-uem.js', 'web-fleet.js', 'runtime.json']) assert.ok(dockerfile.includes(file));
  for (const privatePath of ['.git', '.env', 'api', 'tests', '.github']) assert.ok(ignore.includes(privatePath));
});

test('Pages executes the full gate before uploading production', async () => {
  const workflow = await read('.github/workflows/pages.yml');
  assert.match(workflow, /npm ci --ignore-scripts/);
  assert.match(workflow, /npm run check/);
  assert.ok(workflow.indexOf('npm run check') < workflow.indexOf('actions/upload-pages-artifact'));
});

test('Pages artifact includes every local script loaded by the public entrypoint', async () => {
  const [entrypoint, workflow] = await Promise.all([
    read('index.html'),
    read('.github/workflows/pages.yml'),
  ]);
  const localScripts = [...entrypoint.matchAll(/<script\s+[^>]*src=["'](?:\.\/)?([^:"']+)["']/g)]
    .map(match => match[1]);
  const prepareSite = workflow.match(/- name: Prepare static site([\s\S]*?)(?=\n\s*- uses:)/)?.[1] ?? '';

  assert.ok(localScripts.length > 0);
  const missingScripts = localScripts.filter(script => !prepareSite.includes(script));
  assert.deepEqual(missingScripts, []);
});

test('Supabase guide uses a pinned local CLI through npx', async () => {
  const guide = await read('DEPLOY_CLOUD.md');
  assert.match(guide, /npm install --save-dev supabase@/);
  assert.match(guide, /npx supabase db push/);
  assert.doesNotMatch(guide, /npm install --global supabase/);
});

test('cloud guide lists every connector migration through the dedicated RPC verifier', async () => {
  const guide = await read('DEPLOY_CLOUD.md');
  for (const migration of ['202607220003_connector_server_proof.sql','202607220004_exact_connector_envelope.sql','202607220005_fix_connector_upsert_conflict.sql','202607220006_dedicated_connector_rpc_secret.sql']) assert.ok(guide.includes(migration), migration);
});
