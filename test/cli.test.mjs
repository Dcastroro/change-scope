import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const cli = resolve('bin/change-scope.mjs');
const version = JSON.parse(readFileSync('package.json', 'utf8')).version;
function run(args, cwd = process.cwd()) { return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', windowsHide: true }); }
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'scope-cli-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'policy.json'), JSON.stringify({ version: 1, projects: [{ id: 'app', root: 'app' }] }));
  writeFileSync(join(root, 'changes.json'), JSON.stringify(['app/PRIVATE_INPUT_FILENAME']));
  return root;
}
const args = ['plan', '--config', 'policy.json', '--changes', 'changes.json'];

test('offline JSON, text and matrix outputs are usable and omit changed filenames', t => {
  const root = fixture(t);
  const result = run([...args, '--format', 'json'], root);
  assert.equal(result.status, 0); assert.equal(result.stderr, '');
  assert.deepEqual(JSON.parse(result.stdout).projects, ['app']);
  assert.equal(result.stdout.includes('PRIVATE_INPUT'), false);
  assert.match(run(args, root).stdout, /1\/1 projects selected/);
  assert.deepEqual(JSON.parse(run([...args, '--format', 'matrix'], root).stdout), { include: [{ shard: 1, projects: ['app'] }] });
});

test('affected exit code is opt-in and empty plans still exit zero', t => {
  const root = fixture(t);
  assert.equal(run([...args, '--fail-if-affected'], root).status, 1);
  writeFileSync(join(root, 'changes.json'), '[]');
  assert.equal(run([...args, '--fail-if-affected'], root).status, 0);
});

test('invalid usage and missing/invalid input never disclose input or local paths', t => {
  const root = fixture(t);
  for (const options of [['plan'], ['PRIVATE_UNKNOWN_COMMAND'], [...args, '--base', 'PRIVATE_REF'], [...args, '--format', 'invalid'], [...args, '--format', 'json', '--format', 'json']]) {
    const result = run(options, root); assert.equal(result.status, 2);
    assert.equal(JSON.parse(result.stdout).ok, false); assert.equal(result.stdout.includes('PRIVATE_'), false);
  }
  writeFileSync(join(root, 'changes.json'), 'PRIVATE_INVALID_JSON');
  const result = run(args, root); assert.equal(result.status, 2); assert.equal(result.stdout.includes(root), false); assert.equal(result.stdout.includes('PRIVATE_'), false);
  const missing = run(['plan', '--base', 'PRIVATE_REF', '--repo', join(root, 'PRIVATE_PATH')], root);
  assert.equal(missing.status, 2); assert.equal(missing.stdout.includes('PRIVATE_'), false);
});

test('linked input directories are rejected before reading their content', t => {
  const root = fixture(t); const outside = join(root, 'source'); mkdirSync(outside);
  writeFileSync(join(outside, 'policy.json'), '{}');
  symlinkSync(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  const result = run(['plan', '--config', 'link/policy.json', '--changes', 'changes.json'], root);
  assert.equal(result.status, 2); assert.equal(JSON.parse(result.stdout).error.code, 'input-file');
});

test('oversized inputs and directories fail without raw diagnostics', t => {
  const root = fixture(t);
  writeFileSync(join(root, 'policy.json'), 'x'.repeat(1_048_577));
  assert.equal(run(args, root).status, 2);
  assert.equal(run(['plan', '--config', '.', '--changes', 'changes.json'], root).status, 2);
});

test('version/help are available without a repository or credentials', () => {
  assert.equal(run(['--version']).stdout.trim(), version);
  assert.equal(run(['--help']).status, 0); assert.match(run(['--help']).stdout, /Change Scope/);
});
