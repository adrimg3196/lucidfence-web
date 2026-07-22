import { allowMethod, HttpError, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { workspaceId } from '../_lib/validation.js';
import { providerRegistry, syncAllProviders, syncProvider, UemProviderError } from '../_lib/uem.js';

const TIMEOUT_MS = 8000;
const SYNC_ROLES = new Set(['owner', 'admin', 'operator']);

function allowedWorkspaces(env = process.env) {
  return new Set(String(env.UEM_ALLOWED_WORKSPACE_IDS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    const targetWorkspace = workspaceId(req?.query?.workspaceId);
    const { user, accessToken, client } = await requireUser(req, res);
    const allowed = allowedWorkspaces();
    if (!allowed.size) throw new HttpError(503, 'uem_workspace_not_bound', 'UEM credentials are not bound to a workspace');
    if (!allowed.has(targetWorkspace)) throw new HttpError(403, 'workspace_connector_denied', 'This workspace cannot use the configured UEM connectors');
    const membershipQuery = `?select=role&workspace_id=eq.${encodeURIComponent(targetWorkspace)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
    const { payload: membershipRows } = await client.json(`/rest/v1/workspace_members${membershipQuery}`, { accessToken });
    const membership = Array.isArray(membershipRows) ? membershipRows[0] : membershipRows;
    if (!membership || !SYNC_ROLES.has(membership.role)) throw new HttpError(403, 'workspace_role_denied', 'Your workspace role cannot synchronize UEM providers');
    const registry = providerRegistry();
    const requested = String(req?.query?.provider || 'all').toLowerCase();
    if (requested === 'status') {
      sendJson(res, 200, { readOnly: true, providers: registry });
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      if (requested === 'all') {
        const result = await syncAllProviders(process.env, controller.signal);
        sendJson(res, 200, { source: 'multi-uem', readOnly: true, count: result.devices.length, ...result });
        return;
      }
      const provider = registry.find(item => item.id === requested);
      if (!provider) throw new HttpError(404, 'provider_not_found', 'UEM provider was not found');
      if (!provider.configured) throw new HttpError(503, 'provider_not_configured', 'UEM provider is not configured');
      const devices = await syncProvider(provider.id, process.env, controller.signal);
      sendJson(res, 200, { source: provider.id, readOnly: true, count: devices.length, providers: [{ provider: provider.id, status: 'ok', count: devices.length }], devices });
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') sendError(res, new HttpError(504, 'uem_timeout', 'UEM synchronization timed out'));
    else if (error instanceof UemProviderError) sendError(res, new HttpError(error.status, error.code, error.message));
    else sendError(res, error);
  }
}
