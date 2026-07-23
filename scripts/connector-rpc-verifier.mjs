import { createHash, createHmac } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MIGRATIONS_DIR = fileURLToPath(new URL('../supabase/migrations/', import.meta.url));
const BASE_MIGRATION = resolve(MIGRATIONS_DIR, '202607220006_dedicated_connector_rpc_secret.sql');
const HASH_PATTERNS = Object.freeze([
  /(decode\(')([a-f0-9]{64})(',\s*'hex'\))/i,
  /(encode\(\s*(?:extensions\.)?digest\(\s*(?:pg_catalog\.)?convert_to\(\s*connector_server_proof\s*,\s*'UTF8'\s*\)\s*,\s*'sha256'\s*\)\s*,\s*'hex'\s*\)\s*<>\s*')([a-f0-9]{64})(')/i
]);

function verifierPattern(source) { return HASH_PATTERNS.find(pattern => pattern.test(source)); }

export function decodeRpcSecret(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('UEM_CONNECTOR_RPC_SECRET is required');
  const bytes = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw, 'hex') : Buffer.from(raw, 'base64');
  if (bytes.length !== 32) throw new Error('UEM_CONNECTOR_RPC_SECRET must decode to exactly 32 bytes');
  return bytes;
}

export function verifierHash(value) {
  const proof = createHmac('sha256', decodeRpcSecret(value)).update('lucidfence:connector-rpc-proof:v1').digest('base64url');
  return createHash('sha256').update(proof, 'utf8').digest('hex');
}

export function migrationWithVerifier(source, value) {
  const pattern = verifierPattern(source);
  if (!pattern) throw new Error('connector verifier hash was not found in the migration template');
  return source.replace(pattern, `$1${verifierHash(value)}$3`);
}

function timestamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

async function latestVerifierMigration(directory = MIGRATIONS_DIR) {
  const files = (await readdir(directory)).filter(name => name.endsWith('.sql')).sort().reverse();
  for (const name of files) {
    const path = resolve(directory, name), source = await readFile(path, 'utf8');
    if (source.includes('verify_uem_connector_server_proof') && verifierPattern(source)) return { path, source };
  }
  throw new Error('no connector RPC verifier migration was found');
}

export async function run(args = process.argv.slice(2), env = process.env) {
  const write = args.includes('--write');
  const migrationArg = args.find(arg => arg.startsWith('--migration='));
  const explicitPath = migrationArg ? resolve(migrationArg.slice('--migration='.length)) : '';
  const current = explicitPath ? { path: explicitPath, source: await readFile(explicitPath, 'utf8') } : await latestVerifierMigration();
  const expected = migrationWithVerifier(current.source, env.UEM_CONNECTOR_RPC_SECRET);
  if (write) {
    const target = explicitPath || resolve(dirname(current.path), `${timestamp()}_rotate_connector_rpc_verifier.sql`);
    if (!explicitPath && current.source === expected) {
      process.stdout.write('Connector RPC verifier already matches the latest migration.\n');
      return true;
    }
    await writeFile(target, expected);
    process.stdout.write(`Connector RPC verifier migration created at ${target} (secret not printed).\n`);
    return true;
  }
  if (current.source !== expected) throw new Error('connector RPC secret does not match the latest verifier migration; run with --write before supabase db push');
  process.stdout.write('Connector RPC verifier matches the latest migration.\n');
  return true;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  run().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}
