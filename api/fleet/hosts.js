import { allowMethod, HttpError, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { fetchFleetHosts, normalizeHost } from '../_lib/fleet.js';

const REQUEST_TIMEOUT_MS = 8000;
const MAX_DEVICES = 10000;

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    await requireUser(req, res);

    const base = String(process.env.FLEET_URL || '').trim();
    const token = String(process.env.FLEET_API_TOKEN || '').trim();
    if (!base || !token) throw new HttpError(503, 'fleet_not_configured', 'Fleet is not configured');

    let parsed;
    try { parsed = new URL(base); } catch { throw new HttpError(500, 'invalid_fleet_config', 'FLEET_URL is invalid'); }
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new HttpError(500, 'invalid_fleet_config', 'FLEET_URL must use HTTPS');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const hosts = await fetchFleetHosts(base, token, String(process.env.FLEET_FLEET_ID || '').trim(), controller.signal);
      const devices = hosts.slice(0, MAX_DEVICES).map(normalizeHost);
      sendJson(res, 200, {
        source: 'fleetdm',
        readOnly: true,
        count: devices.length,
        devices,
        locationWarning: 'Fleet GeoIP is coarse, not GPS; never auto-remediate from it alone.'
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      sendError(res, new HttpError(504, 'fleet_timeout', 'Fleet did not respond in time'));
      return;
    }
    sendError(res, error);
  }
}
