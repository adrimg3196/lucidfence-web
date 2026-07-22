(function (root) {
  'use strict';

  // Browser-side Fleet integration. The browser NEVER sees the Fleet token.
  // It only calls the same-origin BFF at /api/fleet/hosts, which returns
  // normalized, read-only devices (no secrets, no raw sensitive payloads).

  class FleetError extends Error {
    constructor(status, code, message) {
      super(message || 'Fleet request failed');
      this.name = 'FleetError';
      this.status = status;
      this.code = code || 'fleet_error';
    }
  }

  function create(cloud, sanitizeImport) {
    if (!cloud || typeof cloud.request !== 'function') throw new Error('cloud client is required');

    async function load() {
      let payload;
      try {
        payload = await cloud.request('/api/fleet/hosts');
      } catch (error) {
        throw new FleetError(error.status || 502, error.code || 'fleet_error', error.message || 'Fleet request failed');
      }
      const devices = Array.isArray(payload?.devices) ? payload.devices : [];
      if (devices.length > 10000) throw new FleetError(502, 'fleet_response_invalid', 'Respuesta de flota inválida');
      let clean;
      try {
        clean = sanitizeImport({ devices: devices.map(device => ({ ...device, source: 'fleetdm' })) });
      } catch (error) {
        throw new FleetError(400, 'fleet_response_rejected', 'La respuesta de Fleet contiene campos no permitidos');
      }
      return { devices: clean.devices, readOnly: Boolean(payload?.readOnly), locationWarning: payload?.locationWarning || null };
    }

    return Object.freeze({ load, FleetError });
  }

  root.LucidFenceFleet = Object.freeze({ create });
})(typeof globalThis !== 'undefined' ? globalThis : this);
