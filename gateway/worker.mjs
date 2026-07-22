const json=(body,status=200,origin='')=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','access-control-allow-origin':origin,'vary':'origin','x-content-type-options':'nosniff'}});
function allowedOrigin(request,env){const origin=request.headers.get('origin')||'';return origin&&origin===env.ALLOWED_ORIGIN?origin:'';}
function publicBase(value){
  let url;try{url=new URL(String(value||''));}catch{return null;}
  const host=url.hostname.toLowerCase().replace(/^\[|\]$/g,''),parts=host.split('.').map(Number),ipv4=parts.length===4&&parts.every(x=>Number.isInteger(x)&&x>=0&&x<=255);
  const privateHost=host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||(ipv4&&(parts[0]===0||parts[0]===10||parts[0]===127||(parts[0]===169&&parts[1]===254)||(parts[0]===172&&parts[1]>=16&&parts[1]<=31)||(parts[0]===192&&parts[1]===168)||parts[0]>=224));
  if(url.protocol!=='https:'||privateHost||url.username||url.password||url.search||url.hash)return null;
  return url;
}
function compactDevice(item){
  const raw=item&&typeof item==='object'?item:{};
  const latRaw=raw.lat??raw.latitude,lngRaw=raw.lng??raw.longitude??raw.lon;
  const lat=Number(latRaw),lng=Number(lngRaw),valid=latRaw!==null&&latRaw!==undefined&&lngRaw!==null&&lngRaw!==undefined;
  const point=valid&&Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180;
  return{id:String(raw.id||raw.deviceId||raw.device_id||''),providerDeviceId:String(raw.providerDeviceId||raw.id||raw.deviceId||raw.device_id||''),provider:String(raw.provider||'custom-gateway'),providerSources:[String(raw.provider||'custom-gateway')],name:String(raw.name||raw.deviceName||'Dispositivo'),platform:String(raw.platform||raw.os||'unknown'),fenceState:['inside','outside','unknown'].includes(raw.fenceState||raw.fence_state)?String(raw.fenceState||raw.fence_state):'unknown',risk:String(raw.risk||raw.riskLevel||'unknown'),compliant:typeof raw.compliant==='boolean'?raw.compliant:null,lat:point?lat:null,lng:point?lng:null,locationSource:point?String(raw.locationSource||'gateway'):'unknown',locationAccuracy:point?String(raw.locationAccuracy||'unknown'):'unknown',serialNumber:String(raw.serialNumber||raw.serial_number||''),imei:String(raw.imei||''),lastSeen:raw.lastSeen||raw.last_seen_at||null,readOnly:true};
}
export default{
  async fetch(request,env){
    const url=new URL(request.url),origin=allowedOrigin(request,env);
    if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':origin,'access-control-allow-methods':'GET, OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'600','vary':'origin'}});
    if(url.pathname==='/health')return json({ok:true,mode:'read_only',configured:Boolean(env.UPSTREAM_BASE_URL&&env.UPSTREAM_TOKEN)},200,origin);
    if(!origin)return json({error:'origin_not_allowed'},403,'');
    if(request.method!=='GET')return json({error:'read_only_gateway'},405,origin);
    if(url.pathname!=='/v1/fleet')return json({error:'not_found'},404,origin);
    if(!env.UPSTREAM_BASE_URL||!env.UPSTREAM_TOKEN)return json({error:'gateway_not_configured'},503,origin);
    const base=publicBase(env.UPSTREAM_BASE_URL);
    if(!base)return json({error:'invalid_upstream_config'},503,origin);
    let upstream;try{upstream=new URL(env.FLEET_PATH||'/devices',base);}catch{return json({error:'invalid_upstream_config'},503,origin);}
    if(upstream.origin!==base.origin)return json({error:'invalid_upstream_config'},503,origin);
    try{
      const response=await fetch(upstream,{method:'GET',headers:{authorization:`Bearer ${env.UPSTREAM_TOKEN}`,accept:'application/json'},signal:AbortSignal.timeout(8000),redirect:'error'});
      if(!response.ok)return json({error:'upstream_unavailable',status:response.status},502,origin);
      const payload=await response.json(),items=Array.isArray(payload)?payload:(payload.devices||payload.items||[]);
      return json({source:'multi-uem-gateway',readOnly:true,devices:items.slice(0,10000).map(compactDevice)},200,origin);
    }catch{return json({error:'upstream_unavailable'},502,origin);}
  }
};
