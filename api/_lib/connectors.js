import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { HttpError } from './http.js';
import { validateProviderUrl, UemProviderError } from './uem.js';

const MAX_CLEAR_BYTES = 4096;
const PADDED_BYTES = 8192;
const PROVIDERS = Object.freeze({
  fleetdm: Object.freeze({ name: 'FleetDM', mode: 'direct', fields: Object.freeze([
    { id: 'baseUrl', label: 'URL de Fleet', type: 'url', placeholder: 'https://fleet.empresa.com', secret: false, required: true },
    { id: 'apiToken', label: 'API token', type: 'password', placeholder: 'Pega el token de solo lectura', secret: true, required: true },
    { id: 'fleetId', label: 'Fleet ID', type: 'text', placeholder: 'Opcional', secret: false, required: false }
  ]) }),
  applivery: Object.freeze({ name: 'Applivery', mode: 'direct', fields: Object.freeze([
    { id: 'orgId', label: 'Organization ID', type: 'text', placeholder: 'ID de la organización', secret: false, required: true },
    { id: 'apiKey', label: 'Service Account token', type: 'password', placeholder: 'Token Bearer de solo lectura', secret: true, required: true },
    { id: 'apiBase', label: 'API base', type: 'url', placeholder: 'https://api.applivery.io/v1', secret: false, required: false }
  ]) }),
  intune: Object.freeze({ name: 'Microsoft Intune', mode: 'direct', fields: Object.freeze([
    { id: 'tenantId', label: 'Tenant ID', type: 'text', placeholder: 'Microsoft Entra tenant ID', secret: false, required: true },
    { id: 'clientId', label: 'Client ID', type: 'text', placeholder: 'App registration client ID', secret: false, required: true },
    { id: 'clientSecret', label: 'Client secret', type: 'password', placeholder: 'Secreto de la aplicación', secret: true, required: true }
  ]) }),
  jamf: Object.freeze({ name: 'Jamf Pro', mode: 'direct', fields: Object.freeze([
    { id: 'baseUrl', label: 'URL de Jamf', type: 'url', placeholder: 'https://empresa.jamfcloud.com', secret: false, required: true },
    { id: 'clientId', label: 'Client ID', type: 'text', placeholder: 'API role client ID', secret: false, required: true },
    { id: 'clientSecret', label: 'Client secret', type: 'password', placeholder: 'Secreto del API role', secret: true, required: true }
  ]) }),
  'custom-gateway': Object.freeze({ name: 'Gateway compatible', mode: 'gateway', fields: Object.freeze([
    { id: 'baseUrl', label: 'URL del gateway', type: 'url', placeholder: 'https://gateway.empresa.com', secret: false, required: true },
    { id: 'token', label: 'Bearer token', type: 'password', placeholder: 'Token de solo lectura', secret: true, required: true }
  ]) })
});

function secretFromEnv(env, name, code, message) {
  const raw = String(env[name] || '').trim();
  let key;
  try { key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64'); }
  catch { key = Buffer.alloc(0); }
  if (key.length !== 32) throw new HttpError(503, code, message);
  return key;
}

function keyFromEnv(env = process.env) {
  return secretFromEnv(env, 'UEM_SECRETS_ENCRYPTION_KEY', 'connector_vault_not_configured', 'Connector credential vault is not configured');
}

export function connectorRpcProof(env = process.env) {
  const secret = secretFromEnv(env, 'UEM_CONNECTOR_RPC_SECRET', 'connector_rpc_proof_not_configured', 'Connector RPC proof is not configured');
  return createHmac('sha256', secret).update('lucidfence:connector-rpc-proof:v1', 'utf8').digest('base64url');
}

export function connectorCatalog() {
  return Object.entries(PROVIDERS).map(([id, item]) => ({ id, name: item.name, mode: item.mode, fields: item.fields.map(field => ({ ...field })) }));
}

export function connectorProvider(value) {
  const id = String(value || '').trim().toLowerCase();
  if (!PROVIDERS[id]) throw new HttpError(400, 'invalid_connector_provider', 'Connector provider is not supported');
  return id;
}

function cleanField(value, field) {
  const text = String(value ?? '').trim();
  if (field.required && !text) throw new HttpError(400, 'connector_field_required', `${field.label} is required`);
  if (!text) return '';
  if (text.length > (field.secret ? 4096 : 512) || /[\u0000-\u001f\u007f-\u009f]/.test(text)) {
    throw new HttpError(400, 'invalid_connector_field', `${field.label} is invalid`);
  }
  if (field.secret && text.length < 8) throw new HttpError(400, 'invalid_connector_secret', `${field.label} is too short`);
  if (field.type === 'url') {
    try { return validateProviderUrl(text, 'connector', field.id === 'apiBase').toString().replace(/\/$/, ''); }
    catch (error) {
      if (error instanceof UemProviderError) throw new HttpError(400, 'invalid_connector_url', `${field.label} must use public HTTPS`);
      throw error;
    }
  }
  return text;
}

export function validateConnectorConfig(provider, raw) {
  const id = connectorProvider(provider);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'invalid_connector_config', 'Connector config must be an object');
  const schema = PROVIDERS[id];
  const allowed = new Set(schema.fields.map(field => field.id));
  if (Object.keys(raw).some(key => !allowed.has(key))) throw new HttpError(400, 'invalid_connector_field', 'Connector config contains an unknown field');
  return Object.fromEntries(schema.fields.map(field => [field.id, cleanField(raw[field.id], field)]).filter(([, value]) => value !== ''));
}

function aad(workspaceId, provider) { return Buffer.from(`lucidfence:connector:v1:${workspaceId}:${provider}`, 'utf8'); }

export function sealConnectorConfig(config, workspaceId, provider, env = process.env) {
  const clear = Buffer.from(JSON.stringify(config), 'utf8');
  if (clear.length > MAX_CLEAR_BYTES) throw new HttpError(400, 'connector_config_too_large', 'Connector config is too large');
  const padded = randomBytes(PADDED_BYTES);
  padded.writeUInt32BE(clear.length, 0);
  clear.copy(padded, 4);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFromEnv(env), iv);
  cipher.setAAD(aad(workspaceId, provider));
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
}

export function openConnectorConfig(envelope, workspaceId, provider, env = process.env) {
  const parts = String(envelope || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new HttpError(500, 'invalid_connector_envelope', 'Stored connector credential is invalid');
  try {
    const iv = Buffer.from(parts[1], 'base64url');
    const tag = Buffer.from(parts[2], 'base64url');
    const encrypted = Buffer.from(parts[3], 'base64url');
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length !== PADDED_BYTES) throw new Error('shape');
    const decipher = createDecipheriv('aes-256-gcm', keyFromEnv(env), iv);
    decipher.setAAD(aad(workspaceId, provider));
    decipher.setAuthTag(tag);
    const padded = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const length = padded.readUInt32BE(0);
    if (length < 2 || length > MAX_CLEAR_BYTES) throw new Error('length');
    return JSON.parse(padded.subarray(4, 4 + length).toString('utf8'));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, 'connector_decryption_failed', 'Stored connector credential cannot be decrypted');
  }
}

export function connectorHint(provider, config) {
  const schema = PROVIDERS[connectorProvider(provider)];
  const identity = schema.fields.find(field => !field.secret && config[field.id]);
  const label = identity ? String(config[identity.id]).replace(/^https:\/\//, '').slice(0, 64) : schema.name;
  return label;
}

export function connectorConfigToEnv(provider, config) {
  const id = connectorProvider(provider);
  if (id === 'fleetdm') return { FLEET_URL: config.baseUrl, FLEET_API_TOKEN: config.apiToken, FLEET_FLEET_ID: config.fleetId || '' };
  if (id === 'applivery') return { APPLIVERY_API_BASE: config.apiBase || 'https://api.applivery.io/v1', APPLIVERY_ORG_ID: config.orgId, APPLIVERY_API_KEY: config.apiKey };
  if (id === 'intune') return { INTUNE_TENANT_ID: config.tenantId, INTUNE_CLIENT_ID: config.clientId, INTUNE_CLIENT_SECRET: config.clientSecret };
  if (id === 'jamf') return { JAMF_BASE_URL: config.baseUrl, JAMF_CLIENT_ID: config.clientId, JAMF_CLIENT_SECRET: config.clientSecret };
  return { UEM_GATEWAY_URL: config.baseUrl, UEM_GATEWAY_TOKEN: config.token };
}

export function connectorRowsToEnv(rows, workspaceId, env = process.env) {
  const output = {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const provider = connectorProvider(row?.provider);
    const config = openConnectorConfig(row?.sealed_config, workspaceId, provider, env);
    Object.assign(output, connectorConfigToEnv(provider, validateConnectorConfig(provider, config)));
  }
  return output;
}
