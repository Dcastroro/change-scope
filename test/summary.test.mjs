import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const cli = fileURLToPath(new URL('../bin/change-scope.mjs', import.meta.url));
const policy = () => ({
  version: 1,
  projects: [
    { id: 'private-core', root: 'PRIVATE_ROOT/core' },
    {
      id: 'private-web',
      root: 'PRIVATE_ROOT/web',
      dependsOn: ['private-core'],
    },
    { id: 'private-docs', root: 'PRIVATE_ROOT/docs' },
  ],
  ignoredInputs: ['PRIVATE_IGNORED/'],
});
function fixture(t, config = policy()) {
  const root = mkdtempSync(join(tmpdir(), 'scope-summary-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'policy.json'), JSON.stringify(config));
  return root;
}
function run(root, changes, extra = []) {
  writeFileSync(join(root, 'changes.json'), JSON.stringify(changes));
  return spawnSync(
    process.execPath,
    [
      cli,
      'plan',
      '--config',
      'policy.json',
      '--changes',
      'changes.json',
      '--format',
      'summary',
      ...extra,
    ],
    { cwd: root, encoding: 'utf8', timeout: 10000, windowsHide: true },
  );
}
function clean(result) {
  assert.equal(result.error, undefined);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.includes('PRIVATE_'), false);
  assert.equal(result.stdout.includes('private-'), false);
  return JSON.parse(result.stdout);
}

test('summary reports dependent impact and schedule counts without project identifiers', (t) => {
  const root = fixture(t),
    r = run(root, ['PRIVATE_ROOT/core/file', 'PRIVATE_IGNORED/file']);
  assert.equal(r.status, 0);
  assert.deepEqual(clean(r), {
    version: 1,
    ok: true,
    mode: 'selective',
    totals: {
      projects: 3,
      changes: 2,
      direct: 1,
      selected: 2,
      global: 0,
      ignored: 1,
      unmapped: 0,
    },
    batchCount: 2,
    shardCount: 1,
  });
  assert.equal(r.stdout.includes(root), false);
});

test('global and unmapped fallback remain distinguishable in summary counts', (t) => {
  const root = fixture(t);
  for (const [path, field] of [
    ['package.json', 'global'],
    ['PRIVATE_UNMAPPED/file', 'unmapped'],
  ]) {
    const r = run(root, [path]);
    assert.equal(r.status, 0);
    const summary = clean(r);
    assert.equal(summary.mode, 'all');
    assert.equal(summary.totals[field], 1);
    assert.equal(summary.totals.selected, 3);
  }
});

test('summary retains opt-in affected exit and successful empty plans', (t) => {
  const root = fixture(t);
  const affected = run(root, ['PRIVATE_ROOT/web/file'], ['--fail-if-affected']);
  assert.equal(affected.status, 1);
  assert.equal(clean(affected).totals.selected, 1);
  const empty = run(root, [], ['--fail-if-affected']);
  assert.equal(empty.status, 0);
  const summary = clean(empty);
  assert.equal(summary.mode, 'empty');
  assert.equal(summary.batchCount, 0);
  assert.equal(summary.shardCount, 0);
});

test('summary cannot turn a strict unmapped error into a successful report', (t) => {
  const config = policy();
  config.unmapped = 'error';
  const r = run(fixture(t, config), ['PRIVATE_UNMAPPED/file']);
  assert.equal(r.status, 2);
  assert.deepEqual(clean(r), {
    version: 1,
    ok: false,
    error: { code: 'unmapped-change' },
  });
});

test('large selections produce a compact summary instead of an ID list', (t) => {
  const config = {
    version: 1,
    projects: Array.from({ length: 1000 }, (_, i) => ({
      id: `private-p${i}`,
      root: `PRIVATE_ROOT/p${i}`,
    })),
  };
  const r = run(fixture(t, config), ['package.json']);
  assert.equal(r.status, 0);
  const summary = clean(r);
  assert.equal(summary.totals.selected, 1000);
  assert.equal(summary.shardCount, 16);
  assert.equal(summary.batchCount, 1);
  assert.ok(Buffer.byteLength(r.stdout) < 1024);
});

test('Git summary omits resolved commits as well as paths and project IDs', (t) => {
  const root = fixture(t);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^GIT_/i.test(key)),
  );
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_CONFIG_GLOBAL = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const git = (...args) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.hooksPath=' + join(root, 'no-hooks'),
        '-c',
        'commit.gpgSign=false',
        ...args,
      ],
      { cwd: root, env, encoding: 'utf8', timeout: 10000, windowsHide: true },
    );
    assert.equal(result.status, 0, 'fixture Git operation failed');
    return result.stdout.trim();
  };
  git('init', '-b', 'main');
  git('config', 'user.name', 'Summary Fixture');
  git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'change-scope.json'), JSON.stringify(policy()));
  mkdirSync(join(root, 'PRIVATE_ROOT/core'), { recursive: true });
  writeFileSync(join(root, 'PRIVATE_ROOT/core/file'), 'base');
  git('add', '.');
  git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'PRIVATE_ROOT/core/file'), 'changed');
  git('add', '.');
  git('commit', '-m', 'change');
  const head = git('rev-parse', 'HEAD');
  const result = spawnSync(
    process.execPath,
    [cli, 'plan', '--base', base, '--head', head, '--format', 'summary'],
    { cwd: root, env, encoding: 'utf8', timeout: 15000, windowsHide: true },
  );
  assert.equal(result.status, 0);
  const summary = clean(result);
  assert.equal(summary.mode, 'selective');
  assert.equal(summary.totals.selected, 2);
  assert.equal(Object.hasOwn(summary, 'comparison'), false);
  assert.equal(result.stdout.includes(base), false);
  assert.equal(result.stdout.includes(head), false);
  assert.equal(result.stdout.includes(root), false);
});
