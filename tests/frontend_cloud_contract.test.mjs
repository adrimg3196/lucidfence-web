import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('PWA exposes local and central-cloud modes without making cloud mandatory', async () => {
  const html = await read('web.html');
  assert.match(html, /id="cloudBadge"/);
  assert.match(html, /id="cloudUnavailable"/);
  assert.match(html, /id="cloudAuth"/);
  assert.match(html, /id="cloudWorkspace"/);
  assert.match(html, /id="cloudLoginForm"/);
  assert.match(html, /id="cloudSignupForm"/);
  assert.match(html, /id="cloudCreateWorkspace"/);
  assert.match(html, /id="cloudPull"/);
  assert.match(html, /id="cloudPush"/);
  assert.ok(html.indexOf('web-cloud.js') < html.indexOf('web-app.js'));
});

test('frontend binds auth, workspace creation, pull, push and logout', async () => {
  const source = await read('web-app.js');
  for (const fragment of [
    'LucidFenceCloud.create()', '.detect()', '.login(', '.signup(', '.logout()',
    '.listWorkspaces()', '.createWorkspace(', '.pull(', '.push('
  ]) assert.ok(source.includes(fragment), `missing ${fragment}`);
});

test('service worker caches cloud client but never caches API responses', async () => {
  const source = await read('sw.js');
  assert.ok(source.includes("'./web-cloud.js'"));
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /url\.pathname===\'\/runtime\.json\'/);
  assert.match(source, /respondWith\(fetch\(event\.request\)\)/);
});

test('GitHub Pages artifact remains local-only and includes the cloud-capable client safely', async () => {
  const workflow = await read('.github/workflows/pages.yml');
  assert.match(workflow, /web-cloud\.js/);
  assert.match(workflow, /runtime\.json/);
  assert.doesNotMatch(workflow, /api\//);
  assert.doesNotMatch(workflow, /supabase\/migrations/);
});

test('static runtime descriptor disables cloud without a failed request', async () => {
  const runtime = JSON.parse(await read('runtime.json'));
  assert.deepEqual(runtime, { cloud: false, mode: 'local-first' });
  const client = await read('web-cloud.js');
  assert.match(client, /request\('\/runtime\.json'\)/);
});
