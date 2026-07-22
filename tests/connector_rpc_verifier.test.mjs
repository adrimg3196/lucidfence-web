import test from 'node:test';
import assert from 'node:assert/strict';
import { migrationWithVerifier, run, verifierHash } from '../scripts/connector-rpc-verifier.mjs';
import { connectorRpcProof } from '../api/_lib/connectors.js';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const secret = Buffer.alloc(32, 9).toString('base64');

test('connector verifier updates the real staged migration syntax without embedding the secret', () => {
  const source = readFileSync(new URL('../supabase/migrations/202607220006_dedicated_connector_rpc_secret.sql', import.meta.url), 'utf8');
  const updated = migrationWithVerifier(source, secret);
  assert.match(updated, new RegExp(verifierHash(secret)));
  assert.equal(verifierHash(secret), createHash('sha256').update(connectorRpcProof({ UEM_CONNECTOR_RPC_SECRET: secret }), 'utf8').digest('hex'));
  assert.doesNotMatch(updated, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.throws(() => verifierHash('short'), /exactly 32 bytes/);
});

test('connector verifier CLI validates a real migration copy instead of reporting it missing', async () => {
  const source = await readFile(new URL('../supabase/migrations/202607220006_dedicated_connector_rpc_secret.sql', import.meta.url), 'utf8');
  const directory = await mkdtemp(resolve(tmpdir(), 'lucidfence-verifier-'));
  const migration = resolve(directory, 'verifier.sql');
  try {
    await writeFile(migration, migrationWithVerifier(source, secret));
    assert.equal(await run([`--migration=${migration}`], { UEM_CONNECTOR_RPC_SECRET: secret }), true);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
