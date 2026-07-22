import { allowMethod, sendError, sendJson } from '../../_lib/http.js';
import { googleSsoEnabled } from '../../_lib/oauth.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    const providers = googleSsoEnabled() ? [{ id: 'google', label: 'Google' }] : [];
    sendJson(res, 200, { providers });
  } catch (error) { sendError(res, error); }
}
