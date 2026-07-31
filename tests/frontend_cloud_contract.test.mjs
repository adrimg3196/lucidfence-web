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
  assert.match(html, /<body class="cloud-pending">/);
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
  assert.ok(css.includes('body.cloud-auth-open .shell{display:none}'),'authenticated shell must not render behind the auth gate');
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
  const html=await read('web.html'),index=await read('index.html'),source=await read('web-app.js'),client=await read('web-uem.js');
  assert.equal(html,index,'index.html and web.html must remain byte-identical');
  for(const id of ['connectorGrid','uemWizard','uemWizardForm','uemWizardOptions','uemWizardAll','uemWizardSelection','uemWizardMeter','uemWizardCancel','openUemWizard','connectorModal','connectorForm','connectorFields','connectorError','connectorSave','connectorDelete','connectorClose'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/id="openUemWizard" aria-controls="uemWizard" aria-expanded="false"/);
  assert.match(html,/Centro de integraciones|CENTRO DE INTEGRACIONES/);
  assert.match(html,/Cifrado AES-256-GCM/);
  assert.match(html,/Nunca se muestran de nuevo/);
  for(const fragment of ['refreshUemConnectors(', 'openUemWizard(', 'startUemWizard(', 'openConnectorModal(', 'saveConnector(', 'deleteConnector(', 'form.reset()', 'connectorQueue=selected'])assert.ok(source.includes(fragment),`missing ${fragment}`);
  assert.match(client,/\/api\/uem\/connectors/);
  assert.match(source,/canSync=\['owner','admin','operator'\]\.includes\(workspace\?\.role\)/);
  assert.match(source,/\$\('#syncAllUem'\)\.disabled=!canSync/);
  assert.match(source,/Tu rol es de solo lectura; no puede sincronizar ni gestionar credenciales/);
  assert.match(source,/activeConnectorId='',activeConnectorWorkspaceId=''/);
  assert.match(source,/activeConnectorId=providerId;activeConnectorWorkspaceId=activeWorkspaceId/);
  assert.match(source,/if\(!activeConnectorWorkspaceId\|\|activeConnectorWorkspaceId!==activeWorkspaceId\)/);
  assert.match(source,/targetWorkspace=activeConnectorWorkspaceId/);
  assert.match(source,/function closeConnectorModal\(force=false\)[\s\S]*if\(connectorSaving&&!force\)return[\s\S]*input\[type="password"\]/);
  assert.match(source,/async function logoutCloud\(\)\{\s*uemRefreshSequence\+=1;resetConnectorFlow\(\);closeUemWizard\(false\);closeConnectorModal\(true\);/);
  assert.match(source,/cloudWorkspaceSelect'\)\.addEventListener\('change',async event=>\{closeConnectorModal\(true\);uemRefreshSequence\+=1;resetConnectorFlow\(\);closeUemWizard\(false\);/);
  assert.match(source,/sequence=\+\+uemRefreshSequence,targetWorkspace=activeWorkspaceId/);
  assert.match(source,/if\(sequence!==uemRefreshSequence\|\|targetWorkspace!==activeWorkspaceId\|\|!cloudUser\)return/);
  assert.match(source,/if\(connectorSaving\|\|!form\.reportValidity\(\)/);
  assert.match(source,/data-test-connector/);
  assert.match(source,/async function testConnector/);
  assert.match(source,/connector_credentials_rejected/);
  assert.match(source,/data-reveal/);
  assert.match(source,/if\(saved\)\{closeConnectorModal\(\);const next=connectorQueue\[0\][\s\S]*if\(openConnectorModal\(next,true\)\)connectorQueue\.shift\(\)/);
  assert.match(source,/const first=connectorQueue\[0\];if\(openConnectorModal\(first,true\)\)connectorQueue\.shift\(\)/);
  assert.match(source,/function cancelConnectorFlow\(\)\{if\(connectorSaving\)return;resetConnectorFlow\(\);closeConnectorModal\(\);\}/);
  assert.match(source,/connectorOpener=fromWizard\?\$\('#openUemWizard'\):document\.activeElement/);
  assert.match(source,/function syncUemWizardAll\(\)[\s\S]*all\.indeterminate=checked>0&&checked<total[\s\S]*uemWizardMeter/);
  assert.match(source,/connectorFlowTotal=selected\.length;connectorFlowStep=1/);
  assert.match(source,/UEM \$\{connectorFlowStep\} de \$\{connectorFlowTotal\}/);
  assert.match(html,/Construye tu stack UEM/);
  assert.match(html,/wizard-provider-mark/);
  assert.match(source,/if\(connectorResult\.status==='fulfilled'\)\{uemConnectors=connectorResult\.value;uemCatalogLoaded=true;\}else uemCatalogLoaded=false/);
  assert.doesNotMatch(source,/connectorResult\.status==='fulfilled'\?connectorResult\.value:\[\]/);
  assert.match(source,/openingWorkspaceId=activeWorkspaceId[\s\S]*await refreshUemConnectors\(\)[\s\S]*activeWorkspaceId!==openingWorkspaceId[\s\S]*owner','admin/);
  assert.match(source,/if\(canManage&&uemCatalogLoaded&&!uemConnectors\.some[\s\S]*uemWizardOpen=true;showView\('connect'\)/);
  assert.match(source,/availableAccess=canManage&&uemCatalogLoaded/);
  assert.match(source,/async function openUemWizard\(\)[\s\S]*if\(!uemCatalogLoaded\)[\s\S]*await refreshUemConnectors\(\)[\s\S]*No se pudo cargar el catálogo UEM/);
  assert.match(source,/function closeUemWizard\(returnFocus=true\)[\s\S]*aria-expanded'[\s\S]*trigger\.focus\(\)/);
  assert.match(html,/aria-describedby="connectorSubtitle connectorGuide connectorProgress"/);
  assert.match(html,/id="connectorSubtitle" aria-live="polite"/);
  assert.match(source,/wizardSelection\.has\(item\.id\)\?' checked'/);
  assert.match(source,/wizardSelection\.clear\(\);checkedBoxes\.forEach\(input=>wizardSelection\.add\(input\.value\)\)/);
  assert.match(source,/wizardSeenWorkspaces\.clear\(\)/);
  assert.match(source,/dialog\.setAttribute\('aria-busy','true'\)[\s\S]*dialog\.removeAttribute\('aria-busy'\)/);
  assert.match(source,/setConnectorBackgroundInert\(true\)/);
  assert.match(source,/#view-connect > :not\(#connectorModal\)/);
  assert.match(source,/classList\.add\('connector-modal-open'\)/);
  assert.match(source,/classList\.remove\('connector-modal-open'\)/);
  assert.match(html,/body\.connector-modal-open\{overflow:hidden\}/);
  assert.match(html,/\.card-body\{[^}]*overflow-x:auto/);
  assert.match(source,/function evidenceCoverage\(\).*:null;/);
  assert.match(source,/evidenceCoverage\(\)===null\?'—'/);
  assert.match(source,/getElementById\('fleetRows'\)/);
  assert.match(source,/parentElement\.classList\.add\('card-body'\)/);
  assert.match(html,/id="fleetRows"[\s\S]*<\/table>/);
  assert.match(html,/class="card-body"[\s\S]*id="fleetRows"/);
  assert.match(html,/table-scroll/);
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

test('SaaS sync preserves server-verified geofence results and rejects stale tenant responses',async()=>{
  const source=await read('web-app.js');
  assert.match(source,/state\.devices\s*=\s*result\.devices/);
  assert.doesNotMatch(source,/state\.devices\s*=\s*LucidFenceWeb\.applyGeofences\(result\.devices/);
  assert.match(source,/const targetWorkspace=activeWorkspaceId,syncSequence=\+\+uemRefreshSequence/);
  assert.match(source,/syncSequence!==uemRefreshSequence\|\|targetWorkspace!==activeWorkspaceId\|\|!cloudUser/);
  assert.match(source,/uemStatusMessage=.*providers.*status.*ok/s);
  assert.match(source,/uemBindingHint.*uemStatusMessage/s);
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
