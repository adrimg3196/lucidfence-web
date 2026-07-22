import { allowMethod, HttpError, sendError } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';

// Deprecated intentionally: the old Fleet-only route had no workspace binding.
// All provider inventory must pass through /api/uem with workspace allowlist + RBAC.
export default async function handler(req, res) {
  try {
    allowMethod(req, ['GET']);
    await requireUser(req, res);
    throw new HttpError(410, 'fleet_endpoint_moved', 'Use the workspace-bound Multi-UEM endpoint');
  } catch (error) { sendError(res, error); }
}
