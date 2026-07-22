import { allowMethod, sendError, sendJson } from './_lib/http.js';
import { readConfig } from './_lib/supabase.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    try {
      readConfig();
      sendJson(res, 200, { cloud: true, mode: 'central-saas', provider: 'supabase', session: 'httpOnly-cookie' });
    } catch {
      sendJson(res, 200, { cloud: false, mode: 'local-first' });
    }
  } catch (error) { sendError(res, error); }
}
