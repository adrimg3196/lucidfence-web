import test from 'node:test';
import assert from 'node:assert/strict';
import { safeWorkspaceState } from '../api/_lib/validation.js';

await import('../web-core.js');

const SECRET_VARIANTS = [
  'accessToken', 'clientSecret', 'serviceRoleKey', 'privateKey', 'github_token',
  'API Key', 'authorizationHeader', 'device-password', 'jwt', 'accessJwt',
  'bearer', 'cookie', 'sessionKey'
];

test('server rejects common secret field variants', () => {
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

test('obvious secret values are rejected even under innocent field names', () => {
  const values = [
    'Bearer abc.def.ghi',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signaturevalue',
    '-----BEGIN PRIVATE KEY-----\n[REDACTED]\n-----END PRIVATE KEY-----'
  ];
  for (const value of values) {
    assert.throws(() => safeWorkspaceState({ note: value }), error => error?.code === 'secret_value_rejected');
    assert.throws(() => globalThis.LucidFenceWeb.sanitizeImport({ note: value }), /secret values are forbidden/i);
  }
});
