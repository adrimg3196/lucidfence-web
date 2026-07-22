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
  const css=html.match(/<style>([\s\S]*?)<\/style>/)?.[1]||'';
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
  for(const rule of ['.cloud-boot{position:fixed','.cloud-boot-mark svg{width:23px','.auth-sso svg{width:17px','.cloud-auth-gate{position:fixed'])assert.ok(css.includes(rule),`missing CSS rule ${rule}`);
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

test('dashboard exposes a guided connector vault without legacy browser token storage',async()=>{
  const html=await read('web.html'),source=await read('web-app.js'),client=await read('web-uem.js');
  for(const id of ['connectorGrid','connectorModal','connectorForm','connectorFields','connectorError','connectorSave','connectorDelete','connectorClose'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Centro de integraciones|CENTRO DE INTEGRACIONES/);
  assert.match(html,/Cifrado AES-256-GCM/);
  assert.match(html,/Nunca se muestran de nuevo/);
  for(const fragment of ['refreshUemConnectors(', 'openConnectorModal(', 'saveConnector(', 'deleteConnector(', 'form.reset()'])assert.ok(source.includes(fragment),`missing ${fragment}`);
  assert.match(client,/\/api\/uem\/connectors/);
  assert.match(source,/canSync=\['owner','admin','operator'\]\.includes\(workspace\?\.role\)/);
  assert.match(source,/\$\('#syncAllUem'\)\.disabled=!canSync/);
  assert.match(source,/Tu rol es de solo lectura; no puede sincronizar ni gestionar credenciales/);
  assert.match(source,/activeConnectorId='',activeConnectorWorkspaceId=''/);
  assert.match(source,/activeConnectorId=providerId;activeConnectorWorkspaceId=activeWorkspaceId/);
  assert.match(source,/if\(!activeConnectorWorkspaceId\|\|activeConnectorWorkspaceId!==activeWorkspaceId\)/);
  assert.match(source,/targetWorkspace=activeConnectorWorkspaceId/);
  assert.match(source,/function closeConnectorModal\(force=false\)[\s\S]*if\(connectorSaving&&!force\)return[\s\S]*input\[type="password"\]/);
  assert.match(source,/async function logoutCloud\(\)\{\s*uemRefreshSequence\+=1;closeConnectorModal\(true\);\s*try\{await cloud\.logout\(\)/);
  assert.match(source,/cloudWorkspaceSelect'\)\.addEventListener\('change',async event=>\{closeConnectorModal\(true\);uemRefreshSequence\+=1;activeWorkspaceId=/);
  assert.match(source,/sequence=\+\+uemRefreshSequence,targetWorkspace=activeWorkspaceId/);
  assert.match(source,/if\(sequence!==uemRefreshSequence\|\|targetWorkspace!==activeWorkspaceId\|\|!cloudUser\)return/);
  assert.match(source,/if\(connectorSaving\|\|!form\.reportValidity\(\)/);
  assert.match(source,/data-test-connector/);
  assert.match(source,/async function testConnector/);
  assert.match(source,/connector_credentials_rejected/);
  assert.match(source,/data-reveal/);
  assert.match(source,/setConnectorBackgroundInert\(true\)/);
  assert.match(source,/#view-connect > :not\(#connectorModal\)/);
  assert.match(source,/classList\.add\('connector-modal-open'\)/);
  assert.match(source,/classList\.remove\('connector-modal-open'\)/);
  assert.match(html,/body\.connector-modal-open\{overflow:hidden\}/);
  assert.match(source,/event\.key==='Tab'/);
  assert.match(source,/connectorOpener/);
  assert.match(source,/connectorOpenerProviderId/);
  assert.match(source,/opener\.focus\(\)/);
  assert.match(source,/dataset\.connector===openerProviderId/);
  assert.match(source,/createCloudWorkspace\(\)\{[\s\S]*?connectorChecks\.clear\(\)/);
  assert.match(html,/id="connectorProgress"[^>]*aria-live="polite"/);
  assert.match(html,/id="connectorSave"[^>]*>Probar y guardar</);
  assert.doesNotMatch(html,/Solo verás una máscara/);
  assert.doesNotMatch(source,/localStorage.*token|settings.*apiToken|settings.*clientSecret/i);
  assert.doesNotMatch(html,/id="gatewayUrl"|id="saveGateway"|id="syncGateway"/);
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
