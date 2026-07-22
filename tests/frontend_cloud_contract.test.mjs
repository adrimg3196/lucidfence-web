import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('PWA exposes a dedicated SaaS auth shell without making cloud mandatory', async () => {
  const html = await read('web.html');
  for (const id of ['cloudBadge','cloudBoot','cloudUnavailable','cloudAuth','cloudAuthDialog','cloudAuthError','cloudAuthLoginTab','cloudAuthSignupTab','cloudWorkspace','cloudLoginForm','cloudSignupForm','cloudCreateWorkspace','cloudPull','cloudPush']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.ok(html.indexOf('web-cloud.js') < html.indexOf('web-app.js'));
  assert.match(html, /id="cloudAuth"[^>]*cloud-auth-gate[^>]*cloud-hidden/);
  assert.match(html, /id="cloudAuthDialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="cloudGoogleSso"[^>]*href="\/api\/auth\/oauth\/start\?provider=google"/);
  assert.match(html, /id="cloudGoogleSso"[^>]*cloud-hidden/);
  assert.match(html, /autocomplete="current-password"/);
  assert.match(html, /autocomplete="new-password"/);
  assert.match(html, /Contraseña segura · mínimo 8 caracteres/);
  assert.match(html, /\.auth-access\{min-width:0/);
  assert.match(html, /\.auth-dialog\{width:100%;max-width:430px;min-width:0/);
});

test('frontend binds auth and prevents cross-workspace push without pull', async () => {
  const source = await read('web-app.js');
  for (const fragment of [
    'LucidFenceCloud.create()', '.detect()', '.login(', '.signup(', '.logout()',
    '.listWorkspaces()', '.createWorkspace(', '.pull(', '.push(', '.oauthProviders()', 'consumeAuthError(',
    'setAuthMode(', 'setAuthBusy(', 'showAuthError(', 'cloudResolved=true'
  ]) assert.ok(source.includes(fragment), `missing ${fragment}`);
  assert.match(source, /cloud\.invalidate\(activeWorkspaceId\)/);
  assert.match(source, /cloud\.canPush\(activeWorkspaceId\)/);
  assert.match(source, /shell\.inert=!cloudResolved\|\|needsAuth/);
  assert.match(source, /shell\.setAttribute\('aria-hidden',String\(!cloudResolved\|\|needsAuth\)\)/);
  assert.match(source, /confirm\(/);
});

test('service worker caches cloud client, bypasses API and deletes only LucidFence caches', async () => {
  const source = await read('sw.js');
  assert.ok(source.includes("'./web-cloud.js'"));
  assert.ok(source.includes("'./web-uem.js'"));
  assert.match(source, /url\.pathname\.startsWith\('\/api\/'\)/);
  assert.match(source, /url\.pathname===\'\/runtime\.json\'/);
  assert.match(source, /respondWith\(fetch\(event\.request\)\)/);
  assert.match(source, /key\.startsWith\('lucidfence-web-'\)/);
});

test('GitHub Pages artifact remains local-only and includes the cloud-capable client safely', async () => {
  const workflow = await read('.github/workflows/pages.yml');
  assert.match(workflow, /web-cloud\.js/);
  assert.match(workflow, /runtime\.json/);
  assert.doesNotMatch(workflow, /cp[^\n]*api\//);
  assert.doesNotMatch(workflow, /cp[^\n]*supabase\/migrations/);
});

test('static runtime descriptor safely disables cloud after dynamic API fallback', async () => {
  const runtime = JSON.parse(await read('runtime.json'));
  assert.deepEqual(runtime, { cloud: false, mode: 'local-first' });
  const client = await read('web-cloud.js');
  const apiRuntime = client.indexOf("'/api/runtime'");
  const staticRuntime = client.indexOf("'/runtime.json'");
  assert.ok(apiRuntime >= 0);
  assert.ok(staticRuntime > apiRuntime);
});
