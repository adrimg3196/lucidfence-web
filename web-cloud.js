(function(root){
  'use strict';

  class CloudError extends Error {
    constructor(status, code, message) {
      super(message || 'Cloud request failed');
      this.name = 'CloudError';
      this.status = status;
      this.code = code || 'cloud_error';
    }
  }

  function create(fetchImpl = root.fetch?.bind(root)) {
    if (typeof fetchImpl !== 'function') throw new Error('fetch is required');
    const revisions = new Map();
    const session = { available: false, user: null };

    async function request(path, options = {}) {
      const response = await fetchImpl(path, {
        method: options.method || 'GET',
        credentials: 'include',
        cache: 'no-store',
        headers: { accept: 'application/json', ...(options.body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
      if (!response.ok) throw new CloudError(response.status, payload?.error, payload?.message || 'Cloud request failed');
      return payload;
    }

    async function detect() {
      if(root.navigator?.onLine===false){session.available=false;return false;}
      for (const path of ['/api/runtime', '/runtime.json']) {
        try {
          const payload = await request(path);
          session.available = payload?.cloud === true;
          return session.available;
        } catch {}
      }
      session.available = false;
      return false;
    }

    async function login(email, password) {
      const payload = await request('/api/auth/login', { method: 'POST', body: { email: String(email || '').trim().toLowerCase(), password } });
      session.user = payload.user;
      return session.user;
    }

    async function signup(email, password) {
      const payload = await request('/api/auth/signup', { method: 'POST', body: { email: String(email || '').trim().toLowerCase(), password } });
      session.user = payload.confirmationRequired ? null : payload.user;
      return payload;
    }

    async function oauthProviders() {
      const payload = await request('/api/auth/oauth/providers');
      return Array.isArray(payload?.providers)
        ? payload.providers.filter(provider => provider?.id === 'google' && provider?.label === 'Google')
        : [];
    }

    async function me() {
      try { const payload = await request('/api/auth/me'); session.user = payload.user; return session.user; }
      catch (error) { if (error.status === 401) session.user = null; else throw error; return null; }
    }

    async function logout() {
      await request('/api/auth/logout', { method: 'POST', body: {} });
      session.user = null;
      revisions.clear();
    }

    async function listWorkspaces() {
      const payload = await request('/api/workspaces');
      return payload.workspaces || [];
    }

    async function createWorkspace(name) {
      const payload = await request('/api/workspaces', { method: 'POST', body: { name } });
      return payload.workspace;
    }

    async function pull(workspaceId) {
      const payload = await request(`/api/workspaces/state?workspaceId=${encodeURIComponent(workspaceId)}`);
      const state = payload.state;
      revisions.set(workspaceId, state.revision);
      return state;
    }

    async function push(workspaceId, state) {
      const expectedRevision = revisions.get(workspaceId);
      if (!Number.isSafeInteger(expectedRevision)) throw new CloudError(409, 'revision_required', 'Pull cloud state before saving');
      const payload = await request('/api/workspaces/state', {
        method: 'PUT', body: { workspaceId, expectedRevision, state }
      });
      revisions.set(workspaceId, payload.state.revision);
      return payload.state;
    }

    function invalidate(workspaceId) { revisions.delete(workspaceId); }
    function canPush(workspaceId) { return Number.isSafeInteger(revisions.get(workspaceId)); }
    function status() { return { available: session.available, user: session.user, revisions: Object.fromEntries(revisions) }; }

    return { detect, login, signup, oauthProviders, me, logout, listWorkspaces, createWorkspace, pull, push, invalidate, canPush, status, request };
  }

  function consumeAuthError(locationLike = root.location, historyLike = root.history) {
    if (!locationLike?.href || typeof historyLike?.replaceState !== 'function') return false;
    let url;
    try { url = new URL(locationLike.href); } catch { return false; }
    const failed = url.searchParams.get('auth_error') === 'sso_failed';
    if (!url.searchParams.has('auth_error')) return false;
    for (const name of ['auth_error', 'code', 'state', 'flow', 'error', 'error_description']) url.searchParams.delete(name);
    const clean = `${url.pathname}${url.search}${url.hash}`;
    historyLike.replaceState(null, '', clean);
    return failed;
  }

  root.LucidFenceCloud = Object.freeze({ create, CloudError, consumeAuthError });
})(typeof globalThis !== 'undefined' ? globalThis : this);
