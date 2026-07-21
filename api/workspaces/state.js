import { allowMethod, assertSameOrigin, HttpError, readJson, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { safeWorkspaceState, workspaceId } from '../_lib/validation.js';

function revision(value) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HttpError(400, 'invalid_revision', 'Expected revision must be a positive integer');
  return parsed;
}

export default async function handler(req, res) {
  try {
    const method = allowMethod(req, ['GET', 'PUT']);
    let targetId;
    let expectedRevision;
    let cleanState;

    if (method === 'GET') {
      targetId = workspaceId(req?.query?.workspaceId);
    } else {
      assertSameOrigin(req);
      const body = readJson(req);
      targetId = workspaceId(body.workspaceId);
      expectedRevision = revision(body.expectedRevision);
      cleanState = safeWorkspaceState(body.state);
      if (!cleanState || Array.isArray(cleanState) || typeof cleanState !== 'object') {
        throw new HttpError(400, 'invalid_workspace_state', 'Workspace state must be an object');
      }
    }

    const { accessToken, client } = await requireUser(req, res);
    if (method === 'GET') {
      const query = `?select=workspace_id,payload,revision,updated_at&workspace_id=eq.${encodeURIComponent(targetId)}&limit=1`;
      const { payload } = await client.json(`/rest/v1/workspace_state${query}`, { accessToken });
      const state = Array.isArray(payload) ? payload[0] : payload;
      if (!state) throw new HttpError(404, 'workspace_state_not_found', 'Workspace state was not found');
      sendJson(res, 200, { state });
      return;
    }

    const { payload } = await client.json('/rest/v1/rpc/save_workspace_state', {
      method: 'POST', accessToken,
      body: { target_workspace_id: targetId, expected_revision: expectedRevision, new_payload: cleanState }
    });
    sendJson(res, 200, { state: Array.isArray(payload) ? payload[0] : payload });
  } catch (error) {
    if (error instanceof HttpError && error.status === 409) sendError(res, new HttpError(409, 'revision_conflict', 'Cloud state changed; reload before overwriting'));
    else sendError(res, error);
  }
}
