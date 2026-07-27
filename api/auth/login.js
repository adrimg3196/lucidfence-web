import { allowMethod, assertSameOrigin, HttpError, isProduction, readJson, sendError, sendJson, sessionCookies } from '../_lib/http.js';
import { createSupabaseClient, readConfig } from '../_lib/supabase.js';
import { credentials, publicUser } from '../_lib/validation.js';
import { checkLoginRateLimit, clearLoginFailures, recordLoginFailure } from '../_lib/rate-limit.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['POST']);
    assertSameOrigin(req);
    const input = credentials(readJson(req));
    const rate = checkLoginRateLimit(req, input.email);
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(rate.retryAfter));
      throw new HttpError(429, 'login_rate_limited', 'Too many login attempts; try again later');
    }
    const client = createSupabaseClient(readConfig());
    let result;
    try {
      result = await client.json('/auth/v1/token?grant_type=password', { method: 'POST', body: input });
    } catch (error) {
      if (error instanceof HttpError && [400, 401].includes(error.status)) {
        recordLoginFailure(req, input.email);
        throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
      }
      throw error;
    }
    clearLoginFailures(req, input.email);
    const session = result.payload;
    res.setHeader('Set-Cookie', sessionCookies(session, isProduction(req)));
    sendJson(res, 200, { user: publicUser(session.user) });
  } catch (error) {
    if (error instanceof HttpError && error.code === 'login_rate_limited') {
      const input = (() => { try { return credentials(readJson(req)); } catch { return null; } })();
      const rate = input ? checkLoginRateLimit(req, input.email) : null;
      if (rate?.retryAfter) res.setHeader('Retry-After', String(rate.retryAfter));
    }
    sendError(res, error);
  }
}
