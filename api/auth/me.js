import { allowMethod, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { publicUser } from '../_lib/validation.js';

export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    const { user } = await requireUser(req, res);
    sendJson(res, 200, { user: publicUser(user) });
  } catch (error) { sendError(res, error); }
}
