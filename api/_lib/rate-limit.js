import { createHash } from 'node:crypto';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_KEYS = 4096;
const attempts = new Map();

function trustedClientAddress(req) {
  const vercel = String(req?.headers?.['x-vercel-forwarded-for'] || '').split(',')[0].trim();
  if (vercel) return vercel.slice(0, 128);
  return String(req?.socket?.remoteAddress || 'unknown').slice(0, 128);
}

function keyFor(req, email) {
  const identity = String(email || '').trim().toLowerCase();
  return createHash('sha256').update(`${trustedClientAddress(req)}\0${identity}`, 'utf8').digest('hex');
}

function purge(now) {
  for (const [key, state] of attempts) {
    if (state.windowStartedAt + WINDOW_MS <= now) attempts.delete(key);
  }
  while (attempts.size > MAX_KEYS) attempts.delete(attempts.keys().next().value);
}

export function checkLoginRateLimit(req, email, now = Date.now()) {
  purge(now);
  const key = keyFor(req, email);
  const state = attempts.get(key);
  if (!state || state.failures < MAX_FAILURES) return { allowed: true, key };
  return {
    allowed: false,
    key,
    retryAfter: Math.max(1, Math.ceil((state.windowStartedAt + WINDOW_MS - now) / 1000))
  };
}

export function recordLoginFailure(req, email, now = Date.now()) {
  purge(now);
  const key = keyFor(req, email);
  const current = attempts.get(key);
  const state = current && current.windowStartedAt + WINDOW_MS > now
    ? { windowStartedAt: current.windowStartedAt, failures: current.failures + 1 }
    : { windowStartedAt: now, failures: 1 };
  attempts.delete(key);
  attempts.set(key, state);
  while (attempts.size > MAX_KEYS) attempts.delete(attempts.keys().next().value);
  return state.failures;
}

export function clearLoginFailures(req, email) {
  attempts.delete(keyFor(req, email));
}

export function resetLoginRateLimitForTests() { attempts.clear(); }
export function loginRateLimitDebugKeys() { return [...attempts.keys()]; }
