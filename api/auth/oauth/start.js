import { allowMethod, HttpError, sendError } from '../../_lib/http.js';
import { readConfig } from '../../_lib/supabase.js';
import { callbackUrl, createOAuthFlow, googleSsoEnabled, oauthFlowCookie, sealOAuthFlow } from '../../_lib/oauth.js';

function query(req) {
  let url;
  try { url = new URL(String(req?.url || ''), 'https://request.invalid'); }
  catch { throw new HttpError(400, 'invalid_request', 'OAuth request is invalid'); }
  const providers = url.searchParams.getAll('provider');
  const returns = url.searchParams.getAll('return');
  if (providers.length !== 1 || returns.length > 1) throw new HttpError(400, 'invalid_request', 'OAuth request is invalid');
  if (returns.length && returns[0] !== 'home') throw new HttpError(400, 'invalid_return', 'OAuth return destination is invalid');
  return providers[0];
}

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    if (!googleSsoEnabled()) throw new HttpError(404, 'oauth_provider_unavailable', 'OAuth provider is unavailable');
    if (query(req) !== 'google') throw new HttpError(400, 'invalid_provider', 'OAuth provider is invalid');
    const config = readConfig();
    const flow = createOAuthFlow();
    const redirectTo = callbackUrl(flow.flowId);
    const authorize = new URL('/auth/v1/authorize', config.url);
    authorize.searchParams.set('provider', 'google');
    authorize.searchParams.set('redirect_to', redirectTo);
    authorize.searchParams.set('code_challenge', flow.codeChallenge);
    authorize.searchParams.set('code_challenge_method', 'S256');

    res.statusCode = 303;
    res.setHeader('Location', authorize.href);
    const flowEnvelope = { flowId: flow.flowId, codeVerifier: flow.codeVerifier, issuedAt: flow.issuedAt, returnTo: flow.returnTo };
    res.setHeader('Set-Cookie', oauthFlowCookie(sealOAuthFlow(flowEnvelope)));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.end();
  } catch (error) { sendError(res, error); }
}
