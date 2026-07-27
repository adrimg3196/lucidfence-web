(function(){
  'use strict';
  let state=null;
  const cloud=LucidFenceCloud.create();
  const uem=LucidFenceUem.create(cloud,LucidFenceWeb.sanitizeImport);
  let cloudAvailable=false,cloudResolved=false,cloudUser=null,cloudWorkspaces=[],cloudOAuthProviders=[],activeWorkspaceId='',uemProviders=[],uemConnectors=[],uemStatusMessage='',authGateVisible=false,activeConnectorId='',activeConnectorWorkspaceId='',uemRefreshSequence=0,connectorSaving=false,connectorChecks=new Map(),connectorOpener=null,connectorOpenerProviderId='';
  const $=selector=>document.querySelector(selector);
  const $$=selector=>Array.from(document.querySelectorAll(selector));
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function toast(message){const node=$('#toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),2600);}
  function showView(id){
    $$('.view').forEach(node=>node.classList.toggle('active',node.id==='view-'+id));
    $$('.nav [data-view]').forEach(node=>node.classList.toggle('active',node.dataset.view===id));
    $('#crumb').textContent=({company:'Compañía',fleet:'Flota',map:'Geovallas',connect:'Conectar'})[id]||'Compañía';
    if(location.hash!=='#'+id) history.replaceState(null,'','#'+id);
  }
  function evidenceCoverage(){const tasks=state.tasks||[];return tasks.length?Math.round(100*tasks.filter(t=>Array.isArray(t.evidence)&&t.evidence.length).length/tasks.length):null;}
  function setAuthMode(mode){
    const signup=mode==='signup';
    $('#cloudLoginForm').classList.toggle('cloud-hidden',signup);
    $('#cloudSignupForm').classList.toggle('cloud-hidden',!signup);
    $('#cloudAuthLoginTab').setAttribute('aria-selected',String(!signup));
    $('#cloudAuthLoginTab').tabIndex=signup?-1:0;
    $('#cloudAuthSignupTab').setAttribute('aria-selected',String(signup));
    $('#cloudAuthSignupTab').tabIndex=signup?0:-1;
    $('#cloudAuthTitle').textContent=signup?'Crea tu organización':'Accede a tu organización';
    $('#cloudAuthSubtitle').textContent=signup?'Configura un espacio seguro para tu equipo y tu flota.':'Continúa donde lo dejaste en tu espacio de operaciones.';
    showAuthError('');
    requestAnimationFrame(()=>$(signup?'#cloudSignupEmail':'#cloudLoginEmail').focus());
  }
  function setAuthBusy(form,busy){
    const button=form.querySelector('button[type="submit"]');
    form.setAttribute('aria-busy',String(busy));
    button.disabled=busy;
    button.textContent=busy?'Verificando acceso…':button.dataset.label;
  }
  function showAuthError(message,tone='error'){
    const node=$('#cloudAuthError');
    node.textContent=message||'';
    node.classList.toggle('cloud-hidden',!message);
    node.classList.toggle('success',tone==='success');
    node.setAttribute('role',tone==='success'?'status':'alert');
  }
  function authMessage(error,mode){
    if(error?.status===401)return 'Email o contraseña incorrectos. Revisa los datos e inténtalo de nuevo.';
    if(error?.status===429)return 'Demasiados intentos. Espera un momento antes de volver a probar.';
    if(error?.status===400||error?.status===422)return mode==='signup'?'No se pudo crear la cuenta. Revisa el email y la contraseña.':'Revisa el email y la contraseña.';
    return 'No pudimos conectar con el servicio de acceso. Inténtalo de nuevo en unos segundos.';
  }
  function renderCloud(){
    const needsAuth=cloudResolved&&cloudAvailable&&!cloudUser,hasGoogle=needsAuth&&cloudOAuthProviders.some(provider=>provider.id==='google');
    $('#cloudBoot').classList.toggle('cloud-hidden',cloudResolved);
    $('#cloudUnavailable').classList.toggle('cloud-hidden',cloudAvailable);
    $('#cloudAuth').classList.toggle('cloud-hidden',!needsAuth);
    $('#cloudAuth').setAttribute('aria-hidden',String(!needsAuth));
    const shell=$('.shell');
    shell.inert=!cloudResolved||needsAuth;
    shell.setAttribute('aria-hidden',String(!cloudResolved||needsAuth));
    document.body.classList.toggle('cloud-auth-open',needsAuth);
    document.body.classList.toggle('cloud-pending',!cloudResolved);
    $('#cloudWorkspace').classList.toggle('cloud-hidden',!cloudAvailable||!cloudUser);
    $('#cloudModeTag').textContent=cloudAvailable?'CENTRAL SAAS':'LOCAL-FIRST';
    $('#cloudBadge').textContent=!cloudAvailable?'Cloud no configurado':cloudUser?'Cloud conectado':'Cloud disponible';
    $('#cloudUser').textContent=cloudUser?.email||'—';
    $('#cloudGoogleSso').classList.toggle('cloud-hidden',!hasGoogle);
    $('#cloudSsoSection').classList.toggle('cloud-hidden',!hasGoogle);
    if(needsAuth&&!authGateVisible)requestAnimationFrame(()=>$('#cloudLoginEmail').focus());
    authGateVisible=needsAuth;
    const select=$('#cloudWorkspaceSelect'),previous=activeWorkspaceId;
    select.innerHTML=cloudWorkspaces.length?cloudWorkspaces.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.role)}</option>`).join(''):'<option value="">Crea el primer workspace</option>';
    if(cloudWorkspaces.some(item=>item.id===previous))select.value=previous;
    else activeWorkspaceId=select.value||'';
    $('#cloudPull').disabled=!activeWorkspaceId;
    $('#cloudPush').disabled=!activeWorkspaceId||!cloud.canPush(activeWorkspaceId);
    renderConnectorCenter();
  }
  function connectorDescription(id){return({fleetdm:'Endpoint y token API de solo lectura.',applivery:'Service Account de Organizations API.',intune:'Aplicación Entra con permisos Graph read-only.',jamf:'API Role con Client Credentials.', 'custom-gateway':'Gateway BYOI para otros UEM.'})[id]||'Conector UEM de solo lectura.';}
  function connectorGuide(id){return({fleetdm:'Necesitas una URL pública de Fleet y un API token con acceso de lectura a hosts.',applivery:'Usa el Organization ID y un Service Account token limitado a consulta.',intune:'Crea una app en Entra con permisos Graph de lectura y pega tenant, client ID y secret.',jamf:'Usa un API Role de solo lectura con Client Credentials.', 'custom-gateway':'El gateway debe exponer /v1/fleet por HTTPS público y aceptar Bearer token.'})[id]||'Usa una credencial dedicada con el mínimo permiso de lectura.';}
  function renderConnectorCenter(){
    const grid=$('#connectorGrid');if(!grid)return;
    const workspace=cloudWorkspaces.find(item=>item.id===activeWorkspaceId),canManage=['owner','admin'].includes(workspace?.role),canSync=['owner','admin','operator'].includes(workspace?.role);
    $('#syncAllUem').disabled=!canSync;
    if(!cloudUser||!activeWorkspaceId){grid.innerHTML='<div class="integration-empty">Inicia sesión y selecciona un workspace para gestionar integraciones.</div>';$('#uemBindingHint').textContent='Selecciona o crea un workspace cloud para empezar.';return;}
    const binding=`${workspace?.name||'Workspace'} · ${canManage?'Puedes configurar, rotar y sincronizar.':canSync?'Puedes sincronizar, pero no gestionar credenciales.':'Tu rol es de solo lectura; no puede sincronizar ni gestionar credenciales.'}`;
    $('#uemBindingHint').textContent=uemStatusMessage?`${binding} · ${uemStatusMessage}`:binding;
    grid.innerHTML=uemConnectors.map(item=>{const check=connectorChecks.get(item.id),checkText=check?.status==='busy'?'Comprobando acceso…':check?.status==='ok'?`${check.devices} dispositivos accesibles`:check?.status==='error'?check.message:'';return `<article class="integration-card"><div class="integration-card-head"><div class="integration-provider"><span class="integration-logo">${esc(item.name.split(/\s+/).map(part=>part[0]).join('').slice(0,2).toUpperCase())}</span><div><h3>${esc(item.name)}</h3><p>${esc(connectorDescription(item.id))}</p></div></div><span class="integration-state ${item.configured?'ready':''}">${item.configured?'ACTIVO':'SIN CONFIGURAR'}</span></div><div class="integration-detail">${item.configured?esc(item.hint||'Identidad del proveedor guardada'):'Conecta y valida en una sola operación.'}${checkText?`<div class="integration-check ${esc(check.status)}">${esc(checkText)}</div>`:''}</div><div class="integration-card-actions"><small>${item.updatedAt?'Verificado '+esc(new Date(item.updatedAt).toLocaleDateString('es-ES')):'Credencial cifrada por workspace'}</small><div class="integration-action-group">${item.configured?`<button class="btn" type="button" data-test-connector="${esc(item.id)}" ${canSync&&check?.status!=='busy'?'':'disabled'}>${check?.status==='busy'?'Probando…':'Probar conexión'}</button>`:''}<button class="btn ${item.configured?'':'primary'}" type="button" data-connector="${esc(item.id)}" ${canManage?'':'disabled'}>${item.configured?'Gestionar':'Conectar'}</button></div></div></article>`;}).join('')||'<div class="integration-empty">No se pudo cargar el catálogo de conectores.</div>';
    const configured=uemConnectors.filter(item=>item.configured).length,snap=LucidFenceWeb.snapshot(state);
    $('#uemSummary').textContent=`${configured} conectores · ${snap.devices} dispositivos`;
  }
  async function testConnector(providerId){
    const targetWorkspace=activeWorkspaceId;if(!targetWorkspace||connectorChecks.get(providerId)?.status==='busy')return;
    connectorChecks.set(providerId,{status:'busy'});renderConnectorCenter();
    try{const result=await uem.sync(providerId,targetWorkspace);if(targetWorkspace!==activeWorkspaceId||!cloudUser)return;connectorChecks.set(providerId,{status:'ok',devices:result.devices.length});}
    catch(error){if(targetWorkspace!==activeWorkspaceId||!cloudUser)return;connectorChecks.set(providerId,{status:'error',message:error.status===401?'Credencial rechazada por el proveedor.':'No se pudo verificar ahora.'});}
    finally{if(targetWorkspace===activeWorkspaceId&&cloudUser)renderConnectorCenter();}
  }
  async function refreshUemConnectors(){
    const sequence=++uemRefreshSequence,targetWorkspace=activeWorkspaceId;
    if(!cloudUser||!targetWorkspace){uemProviders=[];uemConnectors=[];uemStatusMessage='';return;}
    const [statusResult,connectorResult]=await Promise.allSettled([uem.status(targetWorkspace),uem.connectors(targetWorkspace)]);
    if(sequence!==uemRefreshSequence||targetWorkspace!==activeWorkspaceId||!cloudUser)return;
    uemProviders=statusResult.status==='fulfilled'?statusResult.value:[];
    uemConnectors=connectorResult.status==='fulfilled'?connectorResult.value:[];
    uemStatusMessage=statusResult.status==='rejected'?'No se pudo consultar el estado UEM.':connectorResult.status==='rejected'?'No se pudo cargar el vault de conectores.':'';
  }
  function setConnectorBackgroundInert(value){$$('.rail,.top,#view-connect > :not(#connectorModal)').forEach(node=>{node.inert=value;});}
  function connectorProgress(message,tone=''){const node=$('#connectorProgress');node.textContent=message;node.className=`connector-progress${tone?' '+tone:''}`;}
  function closeConnectorModal(force=false){
    if(connectorSaving&&!force)return;
    const opener=connectorOpener,openerProviderId=connectorOpenerProviderId;connectorOpener=null;connectorOpenerProviderId='';const modal=$('#connectorModal');modal.classList.add('cloud-hidden');modal.setAttribute('aria-hidden','true');document.body.classList.remove('connector-modal-open');$('#connectorForm').querySelectorAll('input[type="password"],input[data-secret="true"]').forEach(input=>{input.value='';input.type='password';});activeConnectorId='';activeConnectorWorkspaceId='';$('#connectorForm').reset();$('#connectorFields').replaceChildren();$('#connectorError').classList.add('cloud-hidden');connectorProgress('No guardaremos nada si la prueba de conexión falla.');setConnectorBackgroundInert(false);if(opener?.isConnected&&!opener.disabled)requestAnimationFrame(()=>opener.focus());else{const replacement=$$('#connectorGrid [data-connector]').find(button=>button.dataset.connector===openerProviderId);if(replacement&&!replacement.disabled)requestAnimationFrame(()=>replacement.focus());}
  }
  function openConnectorModal(providerId){
    if(connectorSaving){toast('Espera a que termine la operación de credenciales');return;}
    const connector=uemConnectors.find(item=>item.id===providerId);if(!connector||!activeWorkspaceId)return;
    connectorOpener=document.activeElement instanceof HTMLElement?document.activeElement:null;connectorOpenerProviderId=providerId;activeConnectorId=providerId;activeConnectorWorkspaceId=activeWorkspaceId;$('#connectorTitle').textContent=`${connector.configured?'Gestionar':'Conectar'} ${connector.name}`;$('#connectorSubtitle').textContent=connector.configured?'Pega el conjunto completo para reemplazar la credencial actual.':'Completa los datos; probaremos el acceso antes de guardar.';$('#connectorGuide').textContent=connectorGuide(providerId);
    let secretStarted=false;$('#connectorFields').innerHTML=connector.fields.map((field,index)=>{const startsSecret=field.secret&&!secretStarted;if(field.secret)secretStarted=true;const section=index===0?'<div class="connector-field-section">DATOS DEL PROVEEDOR</div>':startsSecret?'<div class="connector-field-section">CREDENCIAL DE SOLO LECTURA</div>':'';const input=`<input class="auth-input" id="connector-${esc(field.id)}" name="${esc(field.id)}" type="${field.secret?'password':field.type==='url'?'url':'text'}" ${field.secret?'data-secret="true" ':''}${field.required?'required':''} maxlength="${field.secret?'4096':'512'}" autocomplete="${field.secret?'new-password':'off'}" placeholder="${esc(field.placeholder||'')}">`;return `${section}<div class="connector-field"><label for="connector-${esc(field.id)}">${esc(field.label)}</label>${field.secret?`<div class="secret-input-wrap">${input}<button class="secret-toggle" type="button" data-reveal="connector-${esc(field.id)}" aria-label="Mostrar ${esc(field.label)}">Mostrar</button></div>`:input}<small>${field.secret?'Se usa una vez para probar y cifrar; nunca se vuelve a mostrar.':field.required?'Campo obligatorio.':'Opcional; usaremos el valor recomendado.'}</small></div>`;}).join('');
    $('#connectorDelete').classList.toggle('cloud-hidden',!connector.configured);document.body.classList.add('connector-modal-open');$('#connectorError').classList.add('cloud-hidden');connectorProgress('No guardaremos nada si la prueba de conexión falla.');const modal=$('#connectorModal');modal.classList.remove('cloud-hidden');modal.setAttribute('aria-hidden','false');setConnectorBackgroundInert(true);requestAnimationFrame(()=>$('#connectorFields input')?.focus());
  }
  function connectorError(message){const node=$('#connectorError');node.textContent=message;node.classList.toggle('cloud-hidden',!message);}
  async function saveConnector(event){
    event.preventDefault();const form=event.currentTarget;if(connectorSaving||!form.reportValidity()||!activeConnectorId)return;if(!activeConnectorWorkspaceId||activeConnectorWorkspaceId!==activeWorkspaceId){closeConnectorModal(true);toast('El workspace cambió; vuelve a abrir el conector');return;}const button=$('#connectorSave'),provider=activeConnectorId,targetWorkspace=activeConnectorWorkspaceId,deleteButton=$('#connectorDelete'),closeButton=$('#connectorClose');let saved=false;connectorSaving=true;button.disabled=true;deleteButton.disabled=true;closeButton.disabled=true;button.textContent='Probando conexión…';connectorProgress('Contactando con el proveedor mediante un canal seguro…','busy');connectorError('');
    try{const config=Object.fromEntries(new FormData(form).entries()),result=await uem.saveConnector(targetWorkspace,provider,config);form.reset();if(targetWorkspace===activeWorkspaceId&&cloudUser){connectorChecks.set(provider,{status:'ok',devices:result.connection?.devices||0});connectorProgress(`Acceso verificado · ${result.connection?.devices||0} dispositivos accesibles · credencial cifrada.`,'ok');await refreshUemConnectors();renderConnectorCenter();toast('Conector verificado y guardado');}saved=true;}
    catch(error){const message=error.code==='connector_credentials_rejected'?'El proveedor rechazó la credencial. Revisa el token, la URL y los permisos de solo lectura.':error.status===403?'Solo owner o admin puede gestionar credenciales.':error.code==='connector_verification_failed'?'No pudimos comprobar el proveedor. Revisa la URL y vuelve a intentarlo.':error.message||'No se pudo guardar el conector.';connectorProgress('La credencial no se guardó. Corrige los datos y vuelve a probar.');connectorError(message);}
    finally{form.querySelectorAll('input[type="password"],input[data-secret="true"]').forEach(input=>{input.value='';input.type='password';});connectorSaving=false;button.disabled=false;deleteButton.disabled=false;closeButton.disabled=false;button.textContent='Probar y guardar';}
    if(saved)closeConnectorModal();
  }
  async function deleteConnector(){
    if(connectorSaving||!activeConnectorId||!confirm('¿Desconectar este proveedor? La credencial cifrada se eliminará del workspace.'))return;if(!activeConnectorWorkspaceId||activeConnectorWorkspaceId!==activeWorkspaceId){closeConnectorModal(true);toast('El workspace cambió; vuelve a abrir el conector');return;}const provider=activeConnectorId,targetWorkspace=activeConnectorWorkspaceId;let deleted=false;connectorSaving=true;$('#connectorDelete').disabled=true;$('#connectorSave').disabled=true;$('#connectorClose').disabled=true;connectorError('');
    try{await uem.deleteConnector(targetWorkspace,provider);if(targetWorkspace===activeWorkspaceId&&cloudUser){await refreshUemConnectors();renderConnectorCenter();toast('Conector eliminado');}deleted=true;}
    catch(error){connectorError(error.message||'No se pudo eliminar el conector.');}
    finally{connectorSaving=false;$('#connectorDelete').disabled=false;$('#connectorSave').disabled=false;$('#connectorClose').disabled=false;}
    if(deleted)closeConnectorModal();
  }
  async function refreshCloudSession(){
    if(!cloudAvailable){cloudUser=null;cloudWorkspaces=[];cloudOAuthProviders=[];uemProviders=[];uemConnectors=[];uemStatusMessage='';renderCloud();return;}
    cloudUser=await cloud.me();
    cloudWorkspaces=cloudUser?await cloud.listWorkspaces():[];
    if(!cloudWorkspaces.some(item=>item.id===activeWorkspaceId))activeWorkspaceId=cloudWorkspaces[0]?.id||'';
    await refreshUemConnectors();
    renderCloud();
  }
  async function loginCloud(event){
    event.preventDefault();
    const form=event.currentTarget;
    if(!form.reportValidity())return;
    showAuthError('');setAuthBusy(form,true);
    try{await cloud.login($('#cloudLoginEmail').value,$('#cloudLoginPassword').value);form.reset();await refreshCloudSession();toast('Sesión iniciada');}
    catch(error){showAuthError(authMessage(error,'login'));}
    finally{setAuthBusy(form,false);}
  }
  async function signupCloud(event){
    event.preventDefault();
    const form=event.currentTarget;
    if(!form.reportValidity())return;
    showAuthError('');setAuthBusy(form,true);
    try{const result=await cloud.signup($('#cloudSignupEmail').value,$('#cloudSignupPassword').value);form.reset();if(result.confirmationRequired){setAuthMode('login');showAuthError('Cuenta creada. Revisa tu email para confirmar el acceso.','success');return;}await refreshCloudSession();toast('Organización creada');}
    catch(error){showAuthError(authMessage(error,'signup'));}
    finally{setAuthBusy(form,false);}
  }
  async function createCloudWorkspace(){
    try{const workspace=await cloud.createWorkspace($('#cloudWorkspaceName').value);$('#cloudWorkspaceName').value='';cloudWorkspaces=await cloud.listWorkspaces();connectorChecks.clear();activeWorkspaceId=workspace.id;await cloud.pull(activeWorkspaceId);await refreshUemConnectors();renderCloud();toast('Workspace cloud creado');}
    catch(error){toast('Workspace cloud: '+error.message);}
  }
  async function pullCloud(){
    try{
      if(!activeWorkspaceId)throw new Error('Selecciona un workspace');
      const workspaceId=activeWorkspaceId,remote=await cloud.pull(workspaceId);
      if(activeWorkspaceId!==workspaceId){cloud.invalidate(workspaceId);throw new Error('El workspace seleccionado cambió durante la descarga');}
      if(remote.payload&&Object.keys(remote.payload).length){
        if(!confirm('Descargar cloud sustituirá el workspace local de este navegador. Exporta antes si necesitas una copia. ¿Continuar?')){cloud.invalidate(workspaceId);renderCloud();toast('Descarga cancelada; el estado local no cambió');return;}
        const clean=LucidFenceWeb.sanitizeImport(remote.payload);state={...LucidFenceWeb.initialState(),...clean,agents:LucidFenceWeb.AGENTS};await persist();toast('Workspace descargado desde cloud');
      }else{renderCloud();toast('El workspace cloud está vacío; puedes subir este navegador');}
    }
    catch(error){toast('Descarga cloud: '+error.message);}
  }
  async function pushCloud(){
    try{
      if(!activeWorkspaceId)throw new Error('Selecciona un workspace');
      const saved=await cloud.push(activeWorkspaceId,state);
      toast('Workspace sincronizado · revisión '+saved.revision);
    }catch(error){toast(error.code==='revision_conflict'?'Conflicto cloud: descarga la última revisión':'Subida cloud: '+error.message);}
  }
  async function logoutCloud(){
    uemRefreshSequence+=1;closeConnectorModal(true);
    try{await cloud.logout();cloudUser=null;cloudWorkspaces=[];activeWorkspaceId='';uemProviders=[];uemConnectors=[];uemStatusMessage='';connectorChecks.clear();renderCloud();toast('Sesión cloud cerrada; el modo local sigue activo');}
    catch(error){toast('Logout cloud: '+error.message);}
  }
  function render(){
    const snap=LucidFenceWeb.snapshot(state);
    $('#cycleValue').textContent=state.cycle||0;
    $('#goalsValue').textContent=(state.goals||[]).filter(g=>g.status==='active').length;
    $('#outsideValue').textContent=snap.outside;
    $('#complianceValue').textContent=snap.compliance===null?'—':snap.compliance+'%';
    $('#evidenceValue').textContent=evidenceCoverage()===null?'—':evidenceCoverage()+'%';
    if($('#providersValue'))$('#providersValue').textContent=snap.providers?String(snap.providers):'DEMO';
    $('#pauseBtn').textContent=state.paused?'Reanudar compañía':'Pausar compañía';
    $('#runCycle').disabled=state.paused||!(state.goals||[]).some(g=>g.status==='active');
    $('#agents').innerHTML=(state.agents||LucidFenceWeb.AGENTS).map(a=>`<article class="agent"><strong>${esc(a.name)}</strong><p>${esc(a.mission)}</p></article>`).join('');
    $('#goals').innerHTML=(state.goals||[]).length?(state.goals||[]).slice().reverse().map(g=>`<article class="row"><div><strong>${esc(g.title)}</strong><p>${esc(g.outcome)}<br>${esc(g.metric.name)}: ${g.metric.current===null?'—':esc(g.metric.current)} → ${esc(g.metric.target)}</p></div><span class="tag">${esc(g.status.toUpperCase())}</span></article>`).join(''):'<div class="empty">Crea el primer objetivo medible. Ningún ciclo comienza sin una meta.</div>';
    $('#tasks').innerHTML=(state.tasks||[]).length?(state.tasks||[]).slice(-10).reverse().map(t=>`<article class="row"><div><strong>${esc(t.action)}</strong><p>${esc(t.title)} · ${esc(t.agent)}<br>${esc(t.evidence?.[0]?.source||'evidence')} = ${esc(t.evidence?.[0]?.value??'—')}</p></div><span class="tag ${t.risk==='medium'?'medium':''}">${esc(t.risk.toUpperCase())} · ${esc(t.status.toUpperCase())}</span></article>`).join(''):'<div class="empty">La cola está vacía. Ejecuta un ciclo seguro para producir evidencia.</div>';
    $('#fleetRows').innerHTML=(state.devices||[]).map(d=>`<tr><td><strong>${esc(d.name)}</strong><br><span style="color:var(--muted)">${esc(d.id)}</span></td><td>${esc((d.providerSources||[d.provider||'local']).join(' + '))}</td><td>${esc(d.platform)}</td><td class="state ${esc(d.fenceState)}">${esc(d.fenceState)}</td><td>${esc(d.risk)}</td><td>${d.compliant===null||d.compliant===undefined?'Desconocido':d.compliant?'Cumple':'No cumple'}</td></tr>`).join('');
    const table=document.getElementById('fleetRows');if(table&&table.parentElement)table.parentElement.classList.add('card-body');
    renderConnectorCenter();
    const map=$('#map');map.querySelectorAll('.point').forEach(node=>node.remove());
    (state.devices||[]).filter(d=>d.lat!==null&&d.lng!==null).forEach((d,index)=>{const point=document.createElement('button');point.className='point '+(d.fenceState==='outside'?'out':'');point.style.left=(23+(index*13)%62)+'%';point.style.top=(22+(index*17)%59)+'%';point.title=d.name+' · '+d.fenceState;point.setAttribute('aria-label',point.title);map.appendChild(point);});
    renderCloud();
  }
  async function persist(){state.updatedAt=new Date().toISOString();await WebStore.save(state);render();}
  function cycleWithWorker(){return new Promise((resolve,reject)=>{
    if(!('Worker' in window)){try{resolve({state,result:LucidFenceWeb.runCycle(state,LucidFenceWeb.snapshot(state))});}catch(error){reject(error);}return;}
    const worker=new Worker('./web-worker.js');const timer=setTimeout(()=>{worker.terminate();reject(new Error('El worker no respondió'));},6000);
    worker.onmessage=event=>{clearTimeout(timer);worker.terminate();event.data.ok?resolve(event.data):reject(new Error(event.data.error));};
    worker.onerror=event=>{clearTimeout(timer);worker.terminate();reject(new Error(event.message||'Worker error'));};
    worker.postMessage({type:'RUN_CYCLE',state,snapshot:LucidFenceWeb.snapshot(state)});
  });}
  async function runCycle(){
    try{const output=await cycleWithWorker();state=output.state;await persist();toast(`Ciclo ${output.result.cycle}: ${output.result.tasks.length} tareas con evidencia`);}catch(error){toast(error.message);}
  }
  async function createGoal(event){
    event.preventDefault();
    try{const template=LucidFenceWeb.GOAL_TEMPLATES.find(item=>item.id===$('#goalTemplate').value);LucidFenceWeb.createGoal(state,{title:$('#goalTitle').value,outcome:$('#goalOutcome').value,target:$('#goalTarget').value,autonomy:$('#goalAutonomy').value,metricName:template?.metricName,direction:template?.direction,templateId:template?.id});await persist();toast('Objetivo creado');}catch(error){toast(error.message);}
  }
  async function quickGoal(){
    try{
      let goal=(state.goals||[]).find(item=>item.status==='active');
      if(!goal)goal=LucidFenceWeb.createRecommendedGoal(state,'recommend');
      await persist();
      const output=await cycleWithWorker();state=output.state;await persist();
      toast(`/goal listo · ${goal.title} · ${output.result.tasks.length} recomendaciones`);
    }catch(error){toast('/goal: '+error.message);}
  }
  function applyGoalTemplate(){
    const template=LucidFenceWeb.GOAL_TEMPLATES.find(item=>item.id===$('#goalTemplate').value)||LucidFenceWeb.recommendedTemplate(state);
    $('#goalTitle').value=template.title;$('#goalOutcome').value=template.outcome;$('#goalTarget').value=String(template.target);
  }
  async function importWorkspace(file){
    try{const raw=JSON.parse(await file.text());const clean=LucidFenceWeb.sanitizeImport(raw);if(!Array.isArray(clean.devices))throw new Error('El workspace necesita una lista devices');state={...LucidFenceWeb.initialState(),...clean,agents:LucidFenceWeb.AGENTS};state.devices=LucidFenceWeb.applyGeofences(state.devices,state.geofences);await persist();toast('Workspace importado sin secretos');}catch(error){toast('Importación bloqueada: '+error.message);}
  }
  function exportWorkspace(){const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='lucidfence-workspace.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),500);}
  async function init(){
    const oauthFailed=LucidFenceCloud.consumeAuthError();
    state=await WebStore.load();state={...LucidFenceWeb.initialState(),...state,agents:LucidFenceWeb.AGENTS};
    $('#goalForm').addEventListener('submit',createGoal);$('#runCycle').addEventListener('click',runCycle);$('#quickGoal').addEventListener('click',quickGoal);$('#goalTemplate').addEventListener('change',applyGoalTemplate);applyGoalTemplate();
    $('#pauseBtn').addEventListener('click',async()=>{state.paused=!state.paused;await persist();toast(state.paused?'Compañía pausada':'Compañía reanudada');});
    $('#exportBtn').addEventListener('click',exportWorkspace);$('#resetBtn').addEventListener('click',async()=>{if(confirm('¿Eliminar el workspace guardado en este navegador?')){state=await WebStore.reset();render();toast('Workspace restablecido');}});
    $('#importFile').addEventListener('change',event=>{if(event.target.files[0])importWorkspace(event.target.files[0]);event.target.value='';});
    $('#cloudLoginForm').addEventListener('submit',loginCloud);
    $('#cloudSignupForm').addEventListener('submit',signupCloud);
    $('#cloudAuthLoginTab').addEventListener('click',()=>setAuthMode('login'));
    $('#cloudAuthSignupTab').addEventListener('click',()=>setAuthMode('signup'));
    $('#cloudCreateWorkspace').addEventListener('click',createCloudWorkspace);
    $('#cloudPull').addEventListener('click',pullCloud);
    $('#cloudPush').addEventListener('click',pushCloud);
    $('#cloudLogout').addEventListener('click',logoutCloud);
    $('#cloudWorkspaceSelect').addEventListener('change',async event=>{closeConnectorModal(true);uemRefreshSequence+=1;activeWorkspaceId=event.target.value;uemProviders=[];uemConnectors=[];uemStatusMessage='';connectorChecks.clear();if(activeWorkspaceId){cloud.invalidate(activeWorkspaceId);await refreshUemConnectors();}renderCloud();toast('Workspace cambiado; integraciones actualizadas');});
    $('#connectorGrid').addEventListener('click',event=>{const testButton=event.target.closest('[data-test-connector]');if(testButton&&!testButton.disabled){testConnector(testButton.dataset.testConnector);return;}const button=event.target.closest('[data-connector]');if(button&&!button.disabled)openConnectorModal(button.dataset.connector);});
    $('#connectorForm').addEventListener('submit',saveConnector);
    $('#connectorFields').addEventListener('click',event=>{const button=event.target.closest('[data-reveal]');if(!button)return;const input=document.getElementById(button.dataset.reveal);if(!input)return;const reveal=input.type==='password';input.type=reveal?'text':'password';button.textContent=reveal?'Ocultar':'Mostrar';button.setAttribute('aria-label',`${reveal?'Ocultar':'Mostrar'} ${input.name}`);});
    $('#connectorClose').addEventListener('click',()=>closeConnectorModal());
    $('#connectorDelete').addEventListener('click',deleteConnector);
    $('#connectorModal').addEventListener('click',event=>{if(event.target.id==='connectorModal')closeConnectorModal();});
    addEventListener('keydown',event=>{const modal=$('#connectorModal');if(modal.classList.contains('cloud-hidden'))return;if(event.key==='Escape'){closeConnectorModal();return;}if(event.key==='Tab'){const focusable=$$('.connector-dialog button:not([disabled]),.connector-dialog input:not([disabled])').filter(node=>node.offsetParent!==null);if(!focusable.length)return;const first=focusable[0],last=focusable.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}});
    $('#syncAllUem').addEventListener('click',async()=>{
      const targetWorkspace=activeWorkspaceId,syncSequence=++uemRefreshSequence;
      try{
        if(!cloudAvailable||!cloudUser)throw new Error('Inicia sesión cloud para sincronizar proveedores');
        if(!targetWorkspace)throw new Error('Selecciona un workspace');
        const workspace=cloudWorkspaces.find(item=>item.id===targetWorkspace);if(!['owner','admin','operator'].includes(workspace?.role))throw new Error('Tu rol no permite sincronizar proveedores');
        const result=await uem.sync('all',targetWorkspace);
        if(syncSequence!==uemRefreshSequence||targetWorkspace!==activeWorkspaceId||!cloudUser)return;
        uemProviders=uemProviders.map(item=>{const live=result.providers.find(status=>status.provider===item.id);return live?{...item,lastStatus:live.status,lastCount:live.count}:item;});
        const failed=result.providers.filter(status=>status.status!=='ok');
        uemStatusMessage=failed.length?`Cobertura parcial: ${failed.map(status=>status.provider).join(', ')} no respondió`:'';
        if(!result.devices.length)throw new Error('No hay proveedores configurados o no devolvieron dispositivos');
        state.devices=result.devices;state.settings={...state.settings,mode:'multi_uem',uemReadOnly:true,lastSync:new Date().toISOString()};
        await persist();toast(result.devices.length+' dispositivos unificados desde '+result.providers.filter(p=>p.status==='ok').length+' proveedores');showView('fleet');
      }catch(error){if(syncSequence!==uemRefreshSequence||targetWorkspace!==activeWorkspaceId||!cloudUser)return;uemStatusMessage='Última sincronización fallida: '+error.message;renderConnectorCenter();toast('Multi-UEM: '+error.message);}
    });
    $$('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));$$('[data-view-link]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.viewLink)));
    addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(['company','fleet','map','connect'].includes(id))showView(id);});
    render();showView(['company','fleet','map','connect'].includes(location.hash.slice(1))?location.hash.slice(1):'company');
    cloud.detect().then(async available=>{cloudResolved=true;cloudAvailable=available;cloudOAuthProviders=available?await cloud.oauthProviders().catch(()=>[]):[];await refreshCloudSession();if(oauthFailed&&cloudAvailable){setAuthMode('login');showAuthError('No pudimos completar el acceso con Google. Inténtalo de nuevo.');}}).catch(()=>{cloudOAuthProviders=[];renderCloud();});
    window.LucidFenceApp={getState:()=>LucidFenceWeb.clone(state),runCycle,quickGoal};
    if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  addEventListener('DOMContentLoaded',init);
})();
