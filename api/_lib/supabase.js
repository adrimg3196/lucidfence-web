import { HttpError } from './http.js';

function decodeJwtPayload(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  try {
    const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(Buffer.from(normalized, 'base64').toString('utf8'));
  } catch { return null; }
}

export function readConfig(env = process.env) {
  const rawUrl = String(env.SUPABASE_URL || '').trim();
  const key = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || '').trim();
  if (!rawUrl || !key) throw new HttpError(503, 'cloud_not_configured', 'Supabase is not configured');
  let parsed;
  try { parsed = new URL(rawUrl); } catch { throw new HttpError(500, 'invalid_cloud_config', 'SUPABASE_URL is invalid'); }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !local) throw new HttpError(500, 'invalid_cloud_config', 'SUPABASE_URL must use HTTPS');
  if (key.startsWith('sb_secret_') || /service[_-]?role/i.test(key) || decodeJwtPayload(key)?.role === 'service_role') {
    throw new HttpError(500, 'unsafe_cloud_config', 'A secret or service-role key cannot be used by LucidFence Web');
  }
  return { url: parsed.origin, key };
}

export function createSupabaseClient(config = readConfig(), fetchImpl = fetch) {
  async function request(path, options = {}) {
    const headers = {
      apikey: config.key,
      accept: 'application/json',
      ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(options.accessToken ? { authorization: `Bearer ${options.accessToken}` } : {}),
      ...(options.headers || {})
    };
    const response = await fetchImpl(`${config.url}${path}`, {
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal
    });
    return response;
  }

  async function json(path, options = {}) {
    const response = await request(path, options);
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
    if (!response.ok) {
      if (payload?.code === '40001') {
        throw new HttpError(409, 'revision_conflict', 'Cloud state changed; reload before overwriting');
      }
      if (response.status >= 500) {
        throw new HttpError(502, 'cloud_unavailable', 'Cloud provider is temporarily unavailable');
      }
      throw new HttpError(response.status, 'cloud_request_rejected', 'Cloud provider rejected the request');
    }
    return { payload, response };
  }
  return { request, json, config };
}
