export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

const COOKIE_NAMES = Object.freeze({ access: 'lf_access', refresh: 'lf_refresh' });
const MAX_BODY = 1024 * 1024;

function cookie(name, value, maxAge, secure) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sessionCookies(session, secure = true) {
  if (!session?.access_token || !session?.refresh_token) throw new HttpError(502, 'invalid_session', 'Identity provider returned an invalid session');
  const accessAge = Math.min(Math.max(Number(session.expires_in) || 3600, 60), 24 * 60 * 60);
  return [
    cookie(COOKIE_NAMES.access, session.access_token, accessAge, secure),
    cookie(COOKIE_NAMES.refresh, session.refresh_token, 30 * 24 * 60 * 60, secure)
  ];
}

export function clearSessionCookies(secure = true) {
  return [cookie(COOKIE_NAMES.access, '', 0, secure), cookie(COOKIE_NAMES.refresh, '', 0, secure)];
}

export function parseCookies(req) {
  const raw = req?.headers?.cookie || '';
  return Object.fromEntries(raw.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    const name = index < 0 ? part : part.slice(0, index);
    const value = index < 0 ? '' : part.slice(index + 1);
    try { return [name, decodeURIComponent(value)]; } catch { return [name, '']; }
  }));
}

export function sessionFromRequest(req) {
  const values = parseCookies(req);
  return { accessToken: values[COOKIE_NAMES.access] || '', refreshToken: values[COOKIE_NAMES.refresh] || '' };
}

function firstHeader(value) {
  return String(value || '').split(',')[0].trim().toLowerCase();
}

export function assertSameOrigin(req) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(String(req?.method || 'GET').toUpperCase())) return;
  const origin = firstHeader(req?.headers?.origin);
  const host = firstHeader(req?.headers?.['x-forwarded-host'] || req?.headers?.host);
  const protocol = firstHeader(req?.headers?.['x-forwarded-proto'] || 'https');
  if (!origin || !host) throw new HttpError(403, 'origin_denied', 'Request origin is required');
  let parsed;
  try { parsed = new URL(origin); } catch { throw new HttpError(403, 'origin_denied', 'Request origin is invalid'); }
  if (parsed.host.toLowerCase() !== host || parsed.protocol !== `${protocol}:`) {
    throw new HttpError(403, 'origin_denied', 'Request origin is not allowed');
  }
}

export function readJson(req) {
  const declared = Number(req?.headers?.['content-length'] || 0);
  if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY) throw new HttpError(413, 'body_too_large', 'Request body exceeds 1 MiB');
  if (req?.body === undefined || req?.body === null || req?.body === '') return {};
  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  if (Buffer.byteLength(raw) > MAX_BODY) throw new HttpError(413, 'body_too_large', 'Request body exceeds 1 MiB');
  try { return typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
  catch { throw new HttpError(400, 'invalid_json', 'Request body must be valid JSON'); }
}

export function isProduction(req) {
  return firstHeader(req?.headers?.['x-forwarded-proto'] || 'https') === 'https';
}

export function sendJson(res, status, payload, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

export function sendError(res, error) {
  const status = error instanceof HttpError ? error.status : 500;
  const code = error instanceof HttpError ? error.code : 'internal_error';
  const message = error instanceof HttpError ? error.message : 'Unexpected server error';
  sendJson(res, status, { error: code, message });
}

export function allowMethod(req, methods) {
  const method = String(req?.method || 'GET').toUpperCase();
  if (!methods.includes(method)) throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
  return method;
}
