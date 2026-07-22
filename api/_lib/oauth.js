import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './http.js';

export const OAUTH_FLOW_COOKIE = 'lf_oauth_flow';
export const OAUTH_FLOW_TTL_SECONDS = 300;
export const OAUTH_CALLBACK_PATH = '/api/auth/oauth/callback';

const RETURN_DESTINATIONS = Object.freeze({ home: '/' });

function base64url(value) {
  return Buffer.from(value).toString('base64url');
}

function secretKey(env = process.env) {
  const secret = String(env.OAUTH_COOKIE_SECRET || '');
  if (Buffer.byteLength(secret, 'utf8') < 32) {
    throw new HttpError(503, 'oauth_not_configured', 'OAuth cookie protection is not configured');
  }
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function googleSsoEnabled(env = process.env) {
  return String(env.GOOGLE_SSO_ENABLED || '').trim().toLowerCase() === 'true';
}

export function deploymentOrigin(env = process.env) {
  const configured = String(env.APP_ORIGIN || '').trim();
  const vercel = String(env.VERCEL_URL || '').trim();
  if (!configured && !vercel) throw new HttpError(503, 'oauth_not_configured', 'OAuth deployment origin is not configured');
  const candidate = configured || (/^https?:\/\//i.test(vercel) ? vercel : `https://${vercel}`);
  let url;
  try { url = new URL(candidate); } catch { throw new HttpError(500, 'invalid_oauth_config', 'OAuth deployment origin is invalid'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new HttpError(500, 'invalid_oauth_config', 'OAuth deployment origin must be an HTTPS origin');
  }
  return url.origin;
}

export function callbackUrl(env = process.env) {
  return `${deploymentOrigin(env)}${OAUTH_CALLBACK_PATH}`;
}

export function createOAuthFlow(now = Date.now()) {
  const state = base64url(randomBytes(32));
  const codeVerifier = base64url(randomBytes(64));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier, 'ascii').digest());
  return { state, codeVerifier, codeChallenge, issuedAt: now, returnTo: 'home' };
}

export function sealOAuthFlow(flow, env = process.env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(env), iv);
  cipher.setAAD(Buffer.from(OAUTH_FLOW_COOKIE, 'ascii'));
  const plaintext = Buffer.from(JSON.stringify(flow), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [base64url(iv), base64url(encrypted), base64url(cipher.getAuthTag())].join('.');
}

export function openOAuthFlow(value, env = process.env) {
  try {
    const parts = String(value || '').split('.');
    if (parts.length !== 3) throw new Error('invalid envelope');
    const [iv, encrypted, tag] = parts.map(part => Buffer.from(part, 'base64url'));
    if (iv.length !== 12 || tag.length !== 16 || encrypted.length === 0) throw new Error('invalid envelope');
    const decipher = createDecipheriv('aes-256-gcm', secretKey(env), iv);
    decipher.setAAD(Buffer.from(OAUTH_FLOW_COOKIE, 'ascii'));
    decipher.setAuthTag(tag);
    const decoded = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const flow = JSON.parse(decoded.toString('utf8'));
    if (!flow || typeof flow.state !== 'string' || typeof flow.codeVerifier !== 'string' || !Number.isFinite(flow.issuedAt) || !(flow.returnTo in RETURN_DESTINATIONS)) {
      throw new Error('invalid flow');
    }
    return flow;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, 'invalid_oauth_flow', 'OAuth flow is invalid');
  }
}

export function validateOAuthFlow(flow, returnedState, now = Date.now()) {
  const age = now - flow.issuedAt;
  if (age < 0 || age > OAUTH_FLOW_TTL_SECONDS * 1000) throw new HttpError(400, 'invalid_oauth_flow', 'OAuth flow expired');
  const expected = Buffer.from(flow.state, 'utf8');
  const actual = Buffer.from(String(returnedState || ''), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new HttpError(400, 'invalid_oauth_flow', 'OAuth state is invalid');
  }
  return RETURN_DESTINATIONS[flow.returnTo];
}

export function oauthFlowCookie(value, maxAge = OAUTH_FLOW_TTL_SECONDS) {
  return [
    `${OAUTH_FLOW_COOKIE}=${encodeURIComponent(value)}`,
    `Path=/api/auth/oauth`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${Math.min(OAUTH_FLOW_TTL_SECONDS, Math.max(0, Math.floor(maxAge)))}`
  ].join('; ');
}

export function clearOAuthFlowCookie() {
  return oauthFlowCookie('', 0);
}
