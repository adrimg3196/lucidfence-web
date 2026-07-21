import test from 'node:test';
import assert from 'node:assert/strict';
import { safeWorkspaceState } from '../api/_lib/validation.js';

await import('../web-core.js');

const SECRET_VARIANTS = [
  'accessToken',
  'clientSecret',
  'serviceRoleKey',
  'privateKey',
  'github_token',
  'API Key',
  'authorizationHeader',
  'device-password'
];

test('server rejects common camelCase, snake_case, spaced and dashed secret fields', () => {
  for (const key of SECRET_VARIANTS) {
    assert.throws(
      () => safeWorkspaceState({ settings: { [key]: 'sensitive-value' } }),
      error => error?.code === 'secret_field_rejected',
      `server accepted ${key}`
    );
  }
});

test('browser import sanitizer enforces the same secret variants', () => {
  for (const key of SECRET_VARIANTS) {
    assert.throws(
      () => globalThis.LucidFenceWeb.sanitizeImport({ settings: { [key]: 'sensitive-value' } }),
      /secret fields are forbidden/i,
      `browser accepted ${key}`
    );
  }
});

test('normal operational fields remain accepted', () => {
  const state = { settings: { gatewayUrl: 'https://gateway.example', mode: 'demo' }, tokenizedLabel: 'public taxonomy' };
  assert.deepEqual(safeWorkspaceState(state), state);
  assert.deepEqual(globalThis.LucidFenceWeb.sanitizeImport(state), state);
});
