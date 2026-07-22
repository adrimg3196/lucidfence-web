import { allowMethod, assertSameOrigin, isProduction, readJson, sendError, sendJson, sessionCookies } from '../_lib/http.js';
import { createSupabaseClient, readConfig } from '../_lib/supabase.js';
import { credentials, publicUser } from '../_lib/validation.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['POST']);
    assertSameOrigin(req);
    const input = credentials(readJson(req));
    const client = createSupabaseClient(readConfig());
    const { payload } = await client.json('/auth/v1/signup', { method: 'POST', body: input });
    const hasSession = Boolean(payload?.access_token && payload?.refresh_token);
    if (hasSession) res.setHeader('Set-Cookie', sessionCookies(payload, isProduction(req)));
    sendJson(res, 201, { user: publicUser(payload?.user), confirmationRequired: !hasSession });
  } catch (error) { sendError(res, error); }
}
