import { allowMethod, assertSameOrigin, HttpError, isProduction, readJson, sendError, sendJson, sessionCookies } from '../_lib/http.js';
import { createSupabaseClient, readConfig } from '../_lib/supabase.js';
import { credentials, publicUser } from '../_lib/validation.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['POST']);
    assertSameOrigin(req);
    const input = credentials(readJson(req));
    const client = createSupabaseClient(readConfig());
    let result;
    try {
      result = await client.json('/auth/v1/token?grant_type=password', { method: 'POST', body: input });
    } catch (error) {
      if (error instanceof HttpError && [400, 401].includes(error.status)) throw new HttpError(401, 'invalid_credentials', 'Email or password is incorrect');
      throw error;
    }
    const session = result.payload;
    res.setHeader('Set-Cookie', sessionCookies(session, isProduction(req)));
    sendJson(res, 200, { user: publicUser(session.user) });
  } catch (error) { sendError(res, error); }
}
