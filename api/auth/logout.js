import { allowMethod, assertSameOrigin, clearSessionCookies, isProduction, sendError, sendJson, sessionFromRequest } from '../_lib/http.js';
import { createSupabaseClient, readConfig } from '../_lib/supabase.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['POST']);
    assertSameOrigin(req);
    const session = sessionFromRequest(req);
    try {
      if (session.accessToken) {
        const client = createSupabaseClient(readConfig());
        await client.request('/auth/v1/logout', { method: 'POST', accessToken: session.accessToken });
      }
    } catch { /* Local logout remains fail-closed even if the provider is unavailable. */ }
    res.setHeader('Set-Cookie', clearSessionCookies(isProduction(req)));
    sendJson(res, 200, { ok: true });
  } catch (error) { sendError(res, error); }
}
