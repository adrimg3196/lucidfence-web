import { clearSessionCookies, HttpError, isProduction, sessionCookies, sessionFromRequest } from './http.js';
import { createSupabaseClient, readConfig } from './supabase.js';

function clear(res, req) {
  res.setHeader('Set-Cookie', clearSessionCookies(isProduction(req)));
}

export async function requireUser(req, res) {
  const current = sessionFromRequest(req);
  if (!current.accessToken && !current.refreshToken) {
    clear(res, req);
    throw new HttpError(401, 'authentication_required', 'Sign in to use cloud sync');
  }
  const client = createSupabaseClient(readConfig());
  let accessToken = current.accessToken;

  if (accessToken) {
    try {
      const { payload: user } = await client.json('/auth/v1/user', { accessToken });
      return { user, accessToken, client };
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 401) throw error;
    }
  }

  if (!current.refreshToken) {
    clear(res, req);
    throw new HttpError(401, 'authentication_required', 'Your cloud session has expired');
  }

  try {
    const { payload: refreshed } = await client.json('/auth/v1/token?grant_type=refresh_token', {
      method: 'POST', body: { refresh_token: current.refreshToken }
    });
    res.setHeader('Set-Cookie', sessionCookies(refreshed, isProduction(req)));
    accessToken = refreshed.access_token;
    const { payload: user } = await client.json('/auth/v1/user', { accessToken });
    return { user, accessToken, client };
  } catch (error) {
    if (!(error instanceof HttpError) || ![400, 401].includes(error.status)) throw error;
    clear(res, req);
    throw new HttpError(401, 'authentication_required', 'Your cloud session has expired');
  }
}
