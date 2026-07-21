import { HttpError } from './http.js';

export function credentials(body) {
  const email = String(body?.email || '').trim().toLowerCase();
  const password = String(body?.password || '');
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new HttpError(400, 'invalid_email', 'Enter a valid email address');
  }
  if (password.length < 8 || password.length > 128) {
    throw new HttpError(400, 'invalid_password', 'Password must contain 8 to 128 characters');
  }
  return { email, password };
}

export function workspaceName(value) {
  const name = String(value || '').trim();
  if (name.length < 2 || name.length > 120) throw new HttpError(400, 'invalid_workspace_name', 'Workspace name must contain 2 to 120 characters');
  return name;
}

export function workspaceId(value) {
  const id = String(value || '').toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) {
    throw new HttpError(400, 'invalid_workspace_id', 'Workspace id must be a UUID');
  }
  return id;
}

const SECRET_SEGMENTS = new Set(['token', 'secret', 'password', 'credential', 'credentials', 'authorization']);

function canonicalFieldName(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function isSecretField(key) {
  const canonical = canonicalFieldName(key);
  const segments = canonical.split('_').filter(Boolean);
  return segments.some(segment => SECRET_SEGMENTS.has(segment)) ||
    canonical === 'apikey' || canonical.includes('api_key') ||
    canonical.includes('private_key') || canonical.includes('service_role');
}

export function safeWorkspaceState(value, depth = 0) {
  if (depth > 12) throw new HttpError(400, 'invalid_workspace_state', 'Workspace state is too deeply nested');
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new HttpError(400, 'invalid_workspace_state', 'Workspace state contains an oversized list');
    return value.map(item => safeWorkspaceState(item, depth + 1));
  }
  if (typeof value !== 'object') throw new HttpError(400, 'invalid_workspace_state', 'Workspace state contains an unsupported value');
  const clean = {};
  for (const [key, nested] of Object.entries(value)) {
    if (isSecretField(key)) throw new HttpError(400, 'secret_field_rejected', `Secret field rejected: ${key}`);
    clean[key] = safeWorkspaceState(nested, depth + 1);
  }
  return clean;
}

export function publicUser(user) {
  if (!user?.id) return null;
  return { id: String(user.id), email: String(user.email || '') };
}
