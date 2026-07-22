import { allowMethod, HttpError, parseCookies, sendError, sessionCookies } from '../../_lib/http.js';
import { createSupabaseClient, readConfig } from '../../_lib/supabase.js';
import { clearOAuthFlowCookie, googleSsoEnabled, openOAuthFlow, OAUTH_FLOW_COOKIE, validateOAuthFlow } from '../../_lib/oauth.js';

function callbackParams(req) {
  const url = new URL(String(req?.url || ''), 'https://request.invalid');
  const code = url.searchParams.getAll('code');
  const flow = url.searchParams.getAll('flow');
  const error = url.searchParams.getAll('error');
  const descriptions = url.searchParams.getAll('error_description');
  const allowed = new Set(error.length ? ['flow', 'error', 'error_description'] : ['flow', 'code']);
  if ([...url.searchParams.keys()].some(key => !allowed.has(key))) throw new Error('invalid callback');
  if (code.length > 1 || flow.length > 1 || error.length > 1 || descriptions.length > 1 || (code.length && error.length)) throw new Error('invalid callback');
  if (flow.length !== 1 || (code.length !== 1 && error.length !== 1)) throw new Error('invalid callback');
  if (!/^[A-Za-z0-9_-]{43}$/.test(flow[0]) || (code.length && (code[0].length === 0 || code[0].length > 4096))
      || (error.length && (error[0].length === 0 || error[0].length > 256))
      || (descriptions[0]?.length || 0) > 1024) throw new Error('invalid callback');
  return { code: code[0] || '', flowId: flow[0], providerError: error[0] || '' };
}

function redirect(res, location, cookies) {
  res.statusCode = 303;
  res.setHeader('Location', location);
  res.setHeader('Set-Cookie', cookies);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end();
}

export default async function handler(req, res) {
  const clearCookie = clearOAuthFlowCookie();
  try {
    allowMethod(req, ['GET']);
  } catch (error) {
    res.setHeader('Set-Cookie', clearCookie);
    sendError(res, error instanceof HttpError ? error : new HttpError(405, 'method_not_allowed', 'Method not allowed'));
    return;
  }
  try {
    if (!googleSsoEnabled()) throw new Error('provider disabled');
    const params = callbackParams(req);
    const flowValue = parseCookies(req)[OAUTH_FLOW_COOKIE];
    const flow = openOAuthFlow(flowValue);
    const destination = validateOAuthFlow(flow, params.flowId);
    if (params.providerError) throw new Error('provider rejected authorization');
    const client = createSupabaseClient(readConfig());
    const { payload: session } = await client.json('/auth/v1/token?grant_type=pkce', {
      method: 'POST',
      body: { auth_code: params.code, code_verifier: flow.codeVerifier }
    });
    redirect(res, destination, [clearCookie, ...sessionCookies(session, true)]);
  } catch {
    redirect(res, '/?auth_error=sso_failed', [clearCookie]);
  }
}
