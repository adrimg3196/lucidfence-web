import { allowMethod, assertSameOrigin, HttpError, readJson, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { workspaceId } from '../_lib/validation.js';
import {
  connectorCatalog, connectorConfigToEnv, connectorHint, connectorProvider, connectorRowsToEnv, connectorRpcProof, sealConnectorConfig, validateConnectorConfig
} from '../_lib/connectors.js';
import { providerRegistry, syncAllProviders, syncProvider, UemProviderError } from '../_lib/uem.js';

const TIMEOUT_MS = 8000;
const SYNC_ROLES = new Set(['owner', 'admin', 'operator']);
const MANAGE_ROLES = new Set(['owner', 'admin']);

function allowedWorkspaces(env = process.env) {
  return new Set(String(env.UEM_ALLOWED_WORKSPACE_IDS || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
}

function rows(payload) { return Array.isArray(payload) ? payload : (payload ? [payload] : []); }

async function managedStatus(client, accessToken, targetWorkspace) {
  const { payload } = await client.json('/rest/v1/rpc/list_workspace_uem_connectors', {
    method: 'POST', accessToken, body: { target_workspace_id: targetWorkspace }
  });
  return rows(payload);
}

async function managedEnvelopes(client, accessToken, targetWorkspace, provider) {
  const { payload } = await client.json('/rest/v1/rpc/load_workspace_uem_connector', {
    method: 'POST', accessToken,
    body: { target_workspace_id: targetWorkspace, connector_provider: provider, connector_server_proof: connectorRpcProof() }
  });
  return rows(payload);
}

async function requireConnectorManager(client, accessToken, targetWorkspace, userId) {
  const query = `?select=role&workspace_id=eq.${encodeURIComponent(targetWorkspace)}&user_id=eq.${encodeURIComponent(userId)}&limit=1`;
  const { payload } = await client.json(`/rest/v1/workspace_members${query}`, { accessToken });
  const membership = rows(payload)[0];
  if (!membership || !MANAGE_ROLES.has(membership.role)) throw new HttpError(403, 'workspace_role_denied', 'Only workspace owners and admins can manage connector credentials');
}

async function verifyConnector(provider, config) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const devices = await syncProvider(provider, connectorConfigToEnv(provider, config), controller.signal);
    return { status: 'verified', devices: devices.length };
  } catch (error) {
    if (error instanceof UemProviderError || error?.name === 'AbortError') throw error;
    const providerStatus = Number(String(error?.message || '').match(/HTTP\s+(\d{3})/i)?.[1] || 0);
    const denied = providerStatus === 401 || providerStatus === 403;
    throw new UemProviderError(provider, denied ? 'connector_credentials_rejected' : 'connector_verification_failed', denied ? 'The provider rejected these credentials' : 'The provider connection could not be verified', denied ? 401 : 502);
  } finally { clearTimeout(timer); }
}

async function handleConnectorManagement(req, res) {
  const method = allowMethod(req, ['GET', 'PUT', 'DELETE']);
  if (method !== 'GET') assertSameOrigin(req);
  const { user, accessToken, client } = await requireUser(req, res);
  if (method === 'GET') {
    const targetWorkspace = workspaceId(req?.query?.workspaceId);
    const configured = new Map((await managedStatus(client, accessToken, targetWorkspace)).map(row => [row.provider, row]));
    const connectors = connectorCatalog().map(item => {
      const saved = configured.get(item.id);
      return { ...item, configured: Boolean(saved), hint: saved?.config_hint || '', updatedAt: saved?.updated_at || null };
    });
    sendJson(res, 200, { workspaceId: targetWorkspace, connectors, secretsExposed: false });
    return;
  }
  const body = readJson(req);
  const targetWorkspace = workspaceId(body.workspaceId);
  const provider = connectorProvider(body.provider);
  await requireConnectorManager(client, accessToken, targetWorkspace, user.id);
  if (method === 'DELETE') {
    const { payload } = await client.json('/rest/v1/rpc/delete_workspace_uem_connector', {
      method: 'POST', accessToken, body: { target_workspace_id: targetWorkspace, connector_provider: provider, connector_server_proof: connectorRpcProof() }
    });
    sendJson(res, 200, { deleted: payload === true || rows(payload)[0] === true, provider });
    return;
  }
  const config = validateConnectorConfig(provider, body.config);
  const connection = await verifyConnector(provider, config);
  const sealed = sealConnectorConfig(config, targetWorkspace, provider);
  const hint = connectorHint(provider, config);
  const { payload } = await client.json('/rest/v1/rpc/upsert_workspace_uem_connector', {
    method: 'POST', accessToken,
    body: { target_workspace_id: targetWorkspace, connector_provider: provider, connector_sealed_config: sealed, connector_config_hint: hint, connector_server_proof: connectorRpcProof() }
  });
  const saved = rows(payload)[0] || {};
  sendJson(res, 200, { provider, configured: true, hint: saved.config_hint || hint, updatedAt: saved.updated_at || new Date().toISOString(), connection, secretsExposed: false });
}

export default async function handler(req, res) {
  try {
    if (req?.query?.resource === 'connectors' || String(req?.url || '').split('?')[0].endsWith('/connectors')) {
      await handleConnectorManagement(req, res);
      return;
    }
    allowMethod(req, ['GET']);
    const targetWorkspace = workspaceId(req?.query?.workspaceId);
    const { user, accessToken, client } = await requireUser(req, res);
    const membershipQuery = `?select=role&workspace_id=eq.${encodeURIComponent(targetWorkspace)}&user_id=eq.${encodeURIComponent(user.id)}&limit=1`;
    const { payload: membershipRows } = await client.json(`/rest/v1/workspace_members${membershipQuery}`, { accessToken });
    const membership = rows(membershipRows)[0];
    if (!membership || !SYNC_ROLES.has(membership.role)) throw new HttpError(403, 'workspace_role_denied', 'Your workspace role cannot synchronize UEM providers');

    const requested = String(req?.query?.provider || 'all').toLowerCase();
    const legacyAllowed = allowedWorkspaces().has(targetWorkspace);
    if (requested === 'status') {
      const managed = await managedStatus(client, accessToken, targetWorkspace);
      const managedByProvider = new Map(managed.map(item => [item.provider, item]));
      const registry = providerRegistry(legacyAllowed ? process.env : {}).map(item => {
        const saved = managedByProvider.get(item.id);
        return {
          ...item,
          configured: Boolean(saved) || item.configured,
          source: saved ? 'workspace' : (item.configured ? 'deployment' : 'none'),
          hint: saved?.config_hint || '',
          updatedAt: saved?.updated_at || null,
          manageable: MANAGE_ROLES.has(membership.role)
        };
      });
      sendJson(res, 200, { readOnly: true, providers: registry, managedCredentials: true });
      return;
    }

    if (requested !== 'all') connectorProvider(requested);
    const envelopes = await managedEnvelopes(client, accessToken, targetWorkspace, requested);
    const managedEnv = connectorRowsToEnv(envelopes, targetWorkspace);
    const effectiveEnv = legacyAllowed ? { ...process.env, ...managedEnv } : managedEnv;
    const registry = providerRegistry(effectiveEnv);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      if (requested === 'all') {
        const result = await syncAllProviders(effectiveEnv, controller.signal);
        sendJson(res, 200, { source: 'multi-uem', readOnly: true, count: result.devices.length, ...result });
        return;
      }
      const provider = registry.find(item => item.id === requested);
      if (!provider) throw new HttpError(404, 'provider_not_found', 'UEM provider was not found');
      if (!provider.configured) throw new HttpError(503, 'provider_not_configured', 'UEM provider is not configured');
      const devices = await syncProvider(provider.id, effectiveEnv, controller.signal);
      sendJson(res, 200, { source: provider.id, readOnly: true, count: devices.length, providers: [{ provider: provider.id, status: 'ok', count: devices.length }], devices });
    } finally { clearTimeout(timer); }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') sendError(res, new HttpError(504, 'uem_timeout', 'UEM synchronization timed out'));
    else if (error instanceof UemProviderError) sendError(res, new HttpError(error.status, error.code, error.message));
    else sendError(res, error);
  }
}
