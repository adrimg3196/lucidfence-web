import { allowMethod, assertSameOrigin, readJson, sendError, sendJson } from '../_lib/http.js';
import { requireUser } from '../_lib/session.js';
import { workspaceName } from '../_lib/validation.js';

export default async function handler(req, res) {
  try {
    const method = allowMethod(req, ['GET', 'POST']);
    if (method === 'POST') assertSameOrigin(req);
    const input = method === 'POST' ? workspaceName(readJson(req).name) : null;
    const { accessToken, client } = await requireUser(req, res);

    if (method === 'GET') {
      const query = '?select=role,workspace:workspaces(id,name,slug)&order=created_at.asc';
      const { payload } = await client.json(`/rest/v1/workspace_members${query}`, { accessToken });
      const workspaces = (Array.isArray(payload) ? payload : []).filter(item => item?.workspace).map(item => ({ ...item.workspace, role: item.role }));
      sendJson(res, 200, { workspaces });
      return;
    }

    const { payload } = await client.json('/rest/v1/rpc/create_workspace', {
      method: 'POST', accessToken, body: { workspace_name: input }
    });
    sendJson(res, 201, { workspace: Array.isArray(payload) ? payload[0] : payload });
  } catch (error) { sendError(res, error); }
}
