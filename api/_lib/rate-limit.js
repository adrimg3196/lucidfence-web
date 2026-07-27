import { createHash, createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { connectorRpcProof } from './connectors.js';
import { createSupabaseClient, readConfig } from './supabase.js';

const WINDOW_MS = 5 * 60 * 1000;
const MAX_FAILURES = 5;
const MAX_KEYS = 4096;
const localAttempts = new Map();

function trustedClientAddress(req, env = process.env) {
  if (env.VERCEL === '1') {
    const value = String(req?.headers?.['x-vercel-forwarded-for'] || '').split(',')[0].trim();
    return isIP(value) ? value : 'invalid-vercel-client';
  }
  const value = String(req?.socket?.remoteAddress || '').replace(/^::ffff:/, '');
  return isIP(value) ? value : 'unknown-local-client';
}

export function loginBucketKey(req, email, env = process.env) {
  const identity = String(email || '').trim().toLowerCase();
  const address = trustedClientAddress(req, env);
  const secret = String(env.UEM_CONNECTOR_RPC_SECRET || '').trim();
  if (env.VERCEL === '1' && !secret) throw new Error('UEM_CONNECTOR_RPC_SECRET is required');
  return secret
    ? createHmac('sha256', secret).update(`lucidfence:login-rate:v1:${address}\0${identity}`, 'utf8').digest('hex')
    : createHash('sha256').update(`${address}\0${identity}`, 'utf8').digest('hex');
}

function purgeLocal(now) {
  for (const [key, state] of localAttempts) {
    if (state.windowStartedAt + WINDOW_MS <= now) localAttempts.delete(key);
  }
}

function reserveLocal(bucketKey, now = Date.now()) {
  purgeLocal(now);
  const current = localAttempts.get(bucketKey);
  if (!current) {
    if (localAttempts.size >= MAX_KEYS) return { allowed: false, retryAfter: 300, bucketKey };
    localAttempts.set(bucketKey, { windowStartedAt: now, failures: 1 });
    return { allowed: true, retryAfter: 0, bucketKey };
  }
  if (current.failures >= MAX_FAILURES) {
    return { allowed: false, retryAfter: Math.max(1, Math.ceil((current.windowStartedAt + WINDOW_MS - now) / 1000)), bucketKey };
  }
  current.failures += 1;
  return { allowed: true, retryAfter: 0, bucketKey };
}

function finishLocal(bucketKey, outcome) {
  const current = localAttempts.get(bucketKey);
  if (!current) return;
  if (outcome === 'success') localAttempts.delete(bucketKey);
  else if (current.failures <= 1) localAttempts.delete(bucketKey);
  else current.failures -= 1;
}

function rpcClient(env = process.env, fetchImpl = fetch) {
  return createSupabaseClient(readConfig(env), fetchImpl);
}

export async function reserveLoginAttempt(req, email, env = process.env, fetchImpl = fetch) {
  const bucketKey = loginBucketKey(req, email, env);
  if (env.VERCEL !== '1') return reserveLocal(bucketKey);
  const { payload } = await rpcClient(env, fetchImpl).json('/rest/v1/rpc/reserve_login_attempt', {
    method: 'POST',
    body: { target_bucket_key: bucketKey, connector_server_proof: connectorRpcProof(env) }
  });
  const result = Array.isArray(payload) ? payload[0] : payload;
  return { allowed: result?.allowed === true, retryAfter: Math.max(0, Number(result?.retry_after) || 0), bucketKey };
}

export async function finishLoginAttempt(bucketKey, outcome, env = process.env, fetchImpl = fetch) {
  if (!['success', 'provider_error'].includes(outcome)) throw new Error('invalid login attempt outcome');
  if (env.VERCEL !== '1') { finishLocal(bucketKey, outcome); return; }
  await rpcClient(env, fetchImpl).json('/rest/v1/rpc/finish_login_attempt', {
    method: 'POST',
    body: { target_bucket_key: bucketKey, outcome, connector_server_proof: connectorRpcProof(env) }
  });
}

export function resetLoginRateLimitForTests() { localAttempts.clear(); }
export function loginRateLimitDebugKeys() { return [...localAttempts.keys()]; }
