(function (root) {
  'use strict';
  class UemError extends Error {
    constructor(status, code, message) { super(message || 'UEM request failed'); this.name = 'UemError'; this.status = status; this.code = code || 'uem_error'; }
  }
  function create(cloud, sanitizeImport) {
    if (!cloud || typeof cloud.request !== 'function') throw new Error('cloud client is required');
    async function status(workspaceId) { const payload = await cloud.request(`/api/uem?provider=status&workspaceId=${encodeURIComponent(workspaceId)}`); return payload.providers || []; }
    async function sync(provider = 'all', workspaceId) {
      let payload;
      try { payload = await cloud.request(`/api/uem?provider=${encodeURIComponent(provider)}&workspaceId=${encodeURIComponent(workspaceId)}`); }
      catch (error) { throw new UemError(error.status || 502, error.code, error.message); }
      if (!Array.isArray(payload?.devices) || payload.devices.length > 10000) throw new UemError(502, 'uem_response_invalid', 'Respuesta Multi-UEM inválida');
      let clean;
      try { clean = sanitizeImport({ devices: payload.devices }); }
      catch { throw new UemError(400, 'uem_response_rejected', 'La respuesta UEM contiene campos no permitidos'); }
      return { devices: clean.devices, providers: payload.providers || [], readOnly: payload.readOnly === true };
    }
    return Object.freeze({ status, sync });
  }
  root.LucidFenceUem = Object.freeze({ create, UemError });
})(typeof globalThis !== 'undefined' ? globalThis : this);
