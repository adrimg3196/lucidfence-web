import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = name => readFile(new URL(name, root), 'utf8');

test('release builder produces separate local and cloud bundles', async () => {
  const script = await read('scripts/build-release.sh');
  for (const required of ['web-cloud.js', 'runtime.json', 'lucidfence-web-local-', 'lucidfence-web-cloud-', 'SHA256SUMS']) {
    assert.ok(script.includes(required), `release script missing ${required}`);
  }
  assert.match(script, /api/);
  assert.match(script, /supabase/);
  assert.match(script, /zip/);
  assert.match(script, /\[\[ -f "\$file" \]\] \|\| continue/);
});

test('tag workflow uploads both distributions and checksums', async () => {
  const workflow = await read('.github/workflows/release.yml');
  assert.match(workflow, /tags:/);
  assert.match(workflow, /scripts\/build-release\.sh/);
  assert.match(workflow, /softprops\/action-gh-release@v2/);
  assert.match(workflow, /dist\/\*/);
});
