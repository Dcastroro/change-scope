import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../bin/change-scope.mjs', import.meta.url));
const policy = () => ({
  version: 1,
  projects: [
    { id: 'core', root: 'PRIVATE_ROOT/core' },
    { id: 'web', root: 'PRIVATE_ROOT/web', dependsOn: ['core'] },
  ],
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scope-validate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'change-scope.json'), JSON.stringify(policy()));
  return root;
}
function run(root, args = [], env = process.env) {
  return spawnSync(process.execPath, [cli, 'validate', ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
}
function failure(result, code) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    ok: false,
    error: { code },
  });
}

test('validates a complete policy without Git, a changes file, or project details in output', (t) => {
  const root = fixture(t);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  env.PATH = '';
  const result = run(root, [], env);
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    valid: true,
    projects: 2,
  });
  assert.equal(result.stdout.includes(root), false);
  assert.equal(result.stdout.includes('PRIVATE_'), false);
});

test('accepts an explicit config and strict unmapped policy without requiring changes', (t) => {
  const root = fixture(t),
    config = policy();
  config.unmapped = 'error';
  writeFileSync(join(root, 'PRIVATE_POLICY.json'), JSON.stringify(config));
  const result = run(root, ['--config', 'PRIVATE_POLICY.json']);
  assert.equal(result.status, 0);
  assert.deepEqual(JSON.parse(result.stdout), {
    version: 1,
    valid: true,
    projects: 2,
  });
});

test('validation rejects cycles anywhere in the graph', (t) => {
  const root = fixture(t),
    config = policy();
  config.projects[0].dependsOn = ['web'];
  writeFileSync(join(root, 'change-scope.json'), JSON.stringify(config));
  failure(run(root), 'dependency-cycle');
});

test('validation rejects unknown dependencies with value-free diagnostics', (t) => {
  const root = fixture(t),
    config = policy();
  config.projects[1].dependsOn = ['missing'];
  writeFileSync(join(root, 'change-scope.json'), JSON.stringify(config));
  failure(run(root), 'unknown-dependency');
});

test('planning-only flags cannot silently change validation semantics', (t) => {
  const root = fixture(t);
  for (const args of [
    ['--base', 'PRIVATE_REF'],
    ['--head', 'HEAD'],
    ['--repo', '.'],
    ['--changes', 'PRIVATE_FILE'],
    ['--format', 'matrix'],
    ['--format', 'json'],
    ['--comparison', 'direct'],
    ['--fail-if-affected'],
  ]) {
    failure(run(root, args), 'usage');
  }
});

test('file and JSON errors retain existing fixed codes', (t) => {
  const root = fixture(t);
  failure(run(root, ['--config', 'PRIVATE_MISSING']), 'input-file');
  writeFileSync(join(root, 'change-scope.json'), 'PRIVATE_MALFORMED');
  failure(run(root), 'invalid-json');
});

test('validation enforces the config-file size limit', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, 'change-scope.json'), ' '.repeat(1_048_577));
  failure(run(root), 'input-file');
});

test('validation retains rejection of linked config directories', (t) => {
  const root = fixture(t),
    source = join(root, 'source');
  mkdirSync(source);
  writeFileSync(join(source, 'policy.json'), JSON.stringify(policy()));
  symlinkSync(
    source,
    join(root, 'link'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  failure(run(root, ['--config', 'link/policy.json']), 'input-file');
});
