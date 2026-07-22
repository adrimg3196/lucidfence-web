(function(){
  'use strict';
  let state=null;
  const cloud=LucidFenceCloud.create();
  const uem=LucidFenceUem.create(cloud,LucidFenceWeb.sanitizeImport);
  let cloudAvailable=false,cloudUser=null,cloudWorkspaces=[],activeWorkspaceId='',uemProviders=[],uemStatusMessage='';
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
  function evidenceCoverage(){const tasks=state.tasks||[];return tasks.length?Math.round(100*tasks.filter(t=>Array.isArray(t.evidence)&&t.evidence.length).length/tasks.length):100;}
  function renderCloud(){
    $('#cloudUnavailable').classList.toggle('cloud-hidden',cloudAvailable);
    $('#cloudAuth').classList.toggle('cloud-hidden',!cloudAvailable||Boolean(cloudUser));
    $('#cloudWorkspace').classList.toggle('cloud-hidden',!cloudAvailable||!cloudUser);
    $('#cloudModeTag').textContent=cloudAvailable?'CENTRAL SAAS':'LOCAL-FIRST';
    $('#cloudBadge').textContent=!cloudAvailable?'Cloud no configurado':cloudUser?'Cloud conectado':'Cloud disponible';
    $('#cloudUser').textContent=cloudUser?.email||'—';
    const select=$('#cloudWorkspaceSelect'),previous=activeWorkspaceId;
    select.innerHTML=cloudWorkspaces.length?cloudWorkspaces.map(item=>`<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.role)}</option>`).join(''):'<option value="">Crea el primer workspace</option>';
    if(cloudWorkspaces.some(item=>item.id===previous))select.value=previous;
    else activeWorkspaceId=select.value||'';
    $('#cloudPull').disabled=!activeWorkspaceId;
    $('#cloudPush').disabled=!activeWorkspaceId||!cloud.canPush(activeWorkspaceId);
  }
  async function refreshCloudSession(){
    if(!cloudAvailable){cloudUser=null;cloudWorkspaces=[];uemProviders=[];uemStatusMessage='';renderCloud();return;}
    cloudUser=await cloud.me();
    cloudWorkspaces=cloudUser?await cloud.listWorkspaces():[];
    if(!cloudWorkspaces.some(item=>item.id===activeWorkspaceId))activeWorkspaceId=cloudWorkspaces[0]?.id||'';
    if(cloudUser&&activeWorkspaceId){try{uemProviders=await uem.status(activeWorkspaceId);uemStatusMessage='';}catch(error){uemProviders=[];uemStatusMessage=error.code==='uem_workspace_not_bound'||error.code==='workspace_connector_denied'?'Este workspace aún no tiene credenciales UEM vinculadas.':'No se pudo consultar el catálogo UEM.';}}
    renderCloud();
  }
  async function loginCloud(event){
    event.preventDefault();
    try{await cloud.login($('#cloudLoginEmail').value,$('#cloudLoginPassword').value);event.target.reset();await refreshCloudSession();toast('Sesión cloud iniciada');}
    catch(error){toast('Login cloud: '+error.message);}
  }
  async function signupCloud(event){
    event.preventDefault();
    try{const result=await cloud.signup($('#cloudSignupEmail').value,$('#cloudSignupPassword').value);event.target.reset();if(result.confirmationRequired){toast('Revisa tu email para confirmar la cuenta');return;}await refreshCloudSession();toast('Cuenta cloud creada');}
    catch(error){toast('Alta cloud: '+error.message);}
  }
  async function createCloudWorkspace(){
    try{const workspace=await cloud.createWorkspace($('#cloudWorkspaceName').value);$('#cloudWorkspaceName').value='';cloudWorkspaces=await cloud.listWorkspaces();activeWorkspaceId=workspace.id;await cloud.pull(activeWorkspaceId);try{uemProviders=await uem.status(activeWorkspaceId);uemStatusMessage='';}catch{uemProviders=[];uemStatusMessage='Este workspace aún no tiene credenciales UEM vinculadas.';}renderCloud();toast('Workspace cloud creado');}
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
    try{await cloud.logout();cloudUser=null;cloudWorkspaces=[];activeWorkspaceId='';uemProviders=[];uemStatusMessage='';renderCloud();toast('Sesión cloud cerrada; el modo local sigue activo');}
    catch(error){toast('Logout cloud: '+error.message);}
  }
  function render(){
    const snap=LucidFenceWeb.snapshot(state);
    $('#cycleValue').textContent=state.cycle||0;
    $('#goalsValue').textContent=(state.goals||[]).filter(g=>g.status==='active').length;
    $('#outsideValue').textContent=snap.outside;
    $('#complianceValue').textContent=snap.compliance+'%';
    $('#evidenceValue').textContent=evidenceCoverage()+'%';
    if($('#providersValue'))$('#providersValue').textContent=snap.providers?String(snap.providers):'DEMO';
    $('#pauseBtn').textContent=state.paused?'Reanudar compañía':'Pausar compañía';
    $('#gatewayUrl').value=state.settings?.gatewayUrl||'';
    $('#runCycle').disabled=state.paused||!(state.goals||[]).some(g=>g.status==='active');
    $('#agents').innerHTML=(state.agents||LucidFenceWeb.AGENTS).map(a=>`<article class="agent"><strong>${esc(a.name)}</strong><p>${esc(a.mission)}</p></article>`).join('');
    $('#goals').innerHTML=(state.goals||[]).length?(state.goals||[]).slice().reverse().map(g=>`<article class="row"><div><strong>${esc(g.title)}</strong><p>${esc(g.outcome)}<br>${esc(g.metric.name)}: ${g.metric.current===null?'—':esc(g.metric.current)} → ${esc(g.metric.target)}</p></div><span class="tag">${esc(g.status.toUpperCase())}</span></article>`).join(''):'<div class="empty">Crea el primer objetivo medible. Ningún ciclo comienza sin una meta.</div>';
    $('#tasks').innerHTML=(state.tasks||[]).length?(state.tasks||[]).slice(-10).reverse().map(t=>`<article class="row"><div><strong>${esc(t.action)}</strong><p>${esc(t.title)} · ${esc(t.agent)}<br>${esc(t.evidence?.[0]?.source||'evidence')} = ${esc(t.evidence?.[0]?.value??'—')}</p></div><span class="tag ${t.risk==='medium'?'medium':''}">${esc(t.risk.toUpperCase())} · ${esc(t.status.toUpperCase())}</span></article>`).join(''):'<div class="empty">La cola está vacía. Ejecuta un ciclo seguro para producir evidencia.</div>';
    $('#fleetRows').innerHTML=(state.devices||[]).map(d=>`<tr><td><strong>${esc(d.name)}</strong><br><span style="color:var(--muted)">${esc(d.id)}</span></td><td>${esc((d.providerSources||[d.provider||'local']).join(' + '))}</td><td>${esc(d.platform)}</td><td class="state ${esc(d.fenceState)}">${esc(d.fenceState)}</td><td>${esc(d.risk)}</td><td>${d.compliant===null||d.compliant===undefined?'Desconocido':d.compliant?'Cumple':'No cumple'}</td></tr>`).join('');
    if($('#uemProviders'))$('#uemProviders').innerHTML=uemProviders.map(p=>`<span class="tag ${p.configured?'':'medium'}">${esc(p.name)} · ${p.configured?'LISTO':p.mode==='gateway'?'GATEWAY':'NO CONFIG.'}</span>`).join('')||`<span class="cloud-meta">${esc(cloudUser?(uemStatusMessage||'Este workspace no tiene conectores configurados.'):'Inicia sesión cloud para consultar conectores.')}</span>`;
    if($('#uemBindingHint'))$('#uemBindingHint').textContent=activeWorkspaceId?`Workspace activo: ${activeWorkspaceId} · Vincúlalo mediante UEM_ALLOWED_WORKSPACE_IDS.`:'Selecciona o crea un workspace cloud.';
    if($('#uemSummary'))$('#uemSummary').textContent=snap.providers?`${snap.providers} proveedores · ${snap.devices} dispositivos unificados`:`Modo demo · ${snap.devices} dispositivos`;
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
    state=await WebStore.load();state={...LucidFenceWeb.initialState(),...state,agents:LucidFenceWeb.AGENTS};
    $('#goalForm').addEventListener('submit',createGoal);$('#runCycle').addEventListener('click',runCycle);$('#quickGoal').addEventListener('click',quickGoal);$('#goalTemplate').addEventListener('change',applyGoalTemplate);applyGoalTemplate();
    $('#pauseBtn').addEventListener('click',async()=>{state.paused=!state.paused;await persist();toast(state.paused?'Compañía pausada':'Compañía reanudada');});
    $('#exportBtn').addEventListener('click',exportWorkspace);$('#resetBtn').addEventListener('click',async()=>{if(confirm('¿Eliminar el workspace guardado en este navegador?')){state=await WebStore.reset();render();toast('Workspace restablecido');}});
    $('#importFile').addEventListener('change',event=>{if(event.target.files[0])importWorkspace(event.target.files[0]);event.target.value='';});
    $('#cloudLoginForm').addEventListener('submit',loginCloud);
    $('#cloudSignupForm').addEventListener('submit',signupCloud);
    $('#cloudCreateWorkspace').addEventListener('click',createCloudWorkspace);
    $('#cloudPull').addEventListener('click',pullCloud);
    $('#cloudPush').addEventListener('click',pushCloud);
    $('#cloudLogout').addEventListener('click',logoutCloud);
    $('#cloudWorkspaceSelect').addEventListener('change',async event=>{activeWorkspaceId=event.target.value;uemProviders=[];uemStatusMessage='';if(activeWorkspaceId){cloud.invalidate(activeWorkspaceId);try{uemProviders=await uem.status(activeWorkspaceId);}catch{uemProviders=[];uemStatusMessage='Este workspace aún no tiene credenciales UEM vinculadas.';}}renderCloud();toast('Workspace cambiado; descarga antes de subir cambios');});
    $('#saveGateway').addEventListener('click',async()=>{
      try{
        const value=$('#gatewayUrl').value.trim(),url=new URL(value);
        if(url.username||url.password||url.search)throw new Error('La URL no puede contener credenciales ni parámetros');
        if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Usa HTTPS');
        state.settings={...(state.settings||{}),gatewayUrl:url.origin};await persist();toast('URL pública guardada; ningún secreto fue almacenado');
      }catch(error){toast('Gateway no guardado: '+error.message);}
    });
    $('#syncGateway').addEventListener('click',async()=>{
      try{
        const base=state.settings?.gatewayUrl;if(!base)throw new Error('Guarda primero la URL pública');
        const response=await fetch(base+'/v1/fleet',{method:'GET',credentials:'omit',cache:'no-store',headers:{accept:'application/json'}});
        if(!response.ok)throw new Error('El gateway respondió HTTP '+response.status);
        const payload=LucidFenceWeb.sanitizeImport(await response.json());
        if(!Array.isArray(payload.devices)||payload.devices.length>10000)throw new Error('Respuesta de flota inválida');
        state.devices=LucidFenceWeb.applyGeofences(payload.devices,state.geofences);state.settings={...state.settings,mode:'live_gateway',lastSync:new Date().toISOString()};
        await persist();toast(payload.devices.length+' dispositivos sincronizados desde tu gateway');showView('fleet');
      }catch(error){toast('Sincronización fallida: '+error.message);}
    });
    $('#syncAllUem').addEventListener('click',async()=>{
      try{
        if(!cloudAvailable||!cloudUser)throw new Error('Inicia sesión cloud para sincronizar proveedores');
        if(!activeWorkspaceId)throw new Error('Selecciona un workspace');
        const result=await uem.sync('all',activeWorkspaceId);
        uemProviders=uemProviders.map(item=>{const live=result.providers.find(status=>status.provider===item.id);return live?{...item,lastStatus:live.status,lastCount:live.count}:item;});
        if(!result.devices.length)throw new Error('No hay proveedores configurados o no devolvieron dispositivos');
        state.devices=LucidFenceWeb.applyGeofences(result.devices,state.geofences);state.settings={...state.settings,mode:'multi_uem',uemReadOnly:true,lastSync:new Date().toISOString()};
        await persist();toast(result.devices.length+' dispositivos unificados desde '+result.providers.filter(p=>p.status==='ok').length+' proveedores');showView('fleet');
      }catch(error){toast('Multi-UEM: '+error.message);}
    });
    $('#syncAllUemSecondary').addEventListener('click',()=>$('#syncAllUem').click());
    $$('[data-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.view)));$$('[data-view-link]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.viewLink)));
    addEventListener('hashchange',()=>{const id=location.hash.slice(1);if(['company','fleet','map','connect'].includes(id))showView(id);});
    render();showView(['company','fleet','map','connect'].includes(location.hash.slice(1))?location.hash.slice(1):'company');
    cloud.detect().then(async available=>{cloudAvailable=available;await refreshCloudSession();}).catch(()=>{cloudAvailable=false;renderCloud();});
    window.LucidFenceApp={getState:()=>LucidFenceWeb.clone(state),runCycle,quickGoal};
    if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./sw.js').catch(()=>{});
  }
  addEventListener('DOMContentLoaded',init);
})();
