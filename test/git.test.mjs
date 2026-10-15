import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { planGit, ScopeError } from '../src/index.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'change-scope-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => {
    const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, 'fixture Git operation failed'); return r.stdout.trim();
  };
  const file = (path, content) => { mkdirSync(join(root, path, '..'), { recursive: true }); writeFileSync(join(root, path), content); };
  git('init', '-b', 'main'); git('config', 'user.name', 'Scope Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  const config = { version: 1, projects: [{ id: 'core', root: 'packages/core' }, { id: 'web', root: 'apps/web', dependsOn: ['core'] }, { id: 'other', root: 'apps/other' }] };
  file('change-scope.json', JSON.stringify(config)); file('packages/core/a.mjs', 'one'); file('apps/other/b.mjs', 'other');
  git('add', '.'); git('commit', '-m', 'base'); const base = git('rev-parse', 'HEAD');
  const commit = () => { git('add', '-A'); git('commit', '-m', 'change'); return git('rev-parse', 'HEAD'); };
  return { root, git, file, commit, base, config };
}

test('Git planning uses committed head configuration, omits local edits and never echoes refs or paths', t => {
  const f = fixture(t); f.file('packages/core/a.mjs', 'two'); const head = f.commit();
  f.file('change-scope.json', 'PRIVATE_UNCOMMITTED_CONFIG'); f.file('apps/other/local.mjs', 'PRIVATE_LOCAL_INPUT');
  f.git('branch', 'PRIVATE_BRANCH_SENTINEL', head);
  const plan = planGit({ repo: f.root, base: f.base, head: 'PRIVATE_BRANCH_SENTINEL' });
  assert.deepEqual(plan.projects, ['core', 'web']);
  assert.equal(plan.comparison.head, head);
  assert.equal(JSON.stringify(plan).includes('PRIVATE_'), false);
  assert.equal(JSON.stringify(plan).includes(f.root), false);
});

test('rename across ownership boundaries selects source and destination owners', t => {
  const f = fixture(t); f.git('mv', 'packages/core/a.mjs', 'apps/other/a.mjs'); f.commit();
  const plan = planGit({ repo: f.root, base: f.base });
  assert.deepEqual(new Set(plan.projects), new Set(['core', 'web', 'other']));
  assert.equal(plan.totals.changes, 2);
});

test('deleted files still affect their owner and a changed policy selects all', t => {
  const f = fixture(t); f.git('rm', 'packages/core/a.mjs'); f.commit();
  assert.deepEqual(planGit({ repo: f.root, base: f.base }).projects, ['core', 'web']);
  f.file('change-scope.json', JSON.stringify({ ...f.config, ignoredInputs: ['docs/'] })); f.commit();
  assert.equal(planGit({ repo: f.root, base: f.base }).mode, 'all');
});

test('branch merge-base excludes target-only changes while direct comparison includes them', t => {
  const f = fixture(t); f.git('switch', '-c', 'feature'); f.file('packages/core/a.mjs', 'feature'); const head = f.commit();
  f.git('switch', 'main'); f.file('apps/other/b.mjs', 'target'); const base = f.commit();
  const branch = planGit({ repo: f.root, base, head });
  assert.deepEqual(branch.projects, ['core', 'web']); assert.equal(branch.comparison.from, f.base);
  assert.ok(planGit({ repo: f.root, base, head, comparison: 'direct' }).projects.includes('other'));
});

test('missing refs, invalid config and pathspec-like arguments fail with fixed codes', t => {
  const f = fixture(t);
  for (const base of ['PRIVATE_MISSING_REF', '--help']) {
    assert.throws(() => planGit({ repo: f.root, base }), error => error instanceof ScopeError && error.code === 'revision-unavailable' && !error.message.includes(base));
  }
  assert.throws(() => planGit({ repo: f.root, base: f.base, configPath: '../private' }), /invalid-path/);
  f.file('change-scope.json', 'PRIVATE_INVALID_CONFIG'); f.commit();
  assert.throws(() => planGit({ repo: f.root, base: f.base }), error => error.code === 'invalid-json' && !error.message.includes('PRIVATE'));
});

test('external diff drivers and text conversion commands are never executed', t => {
  const f = fixture(t); const marker = join(f.root, 'UNEXPECTED_EXECUTION');
  const script = join(f.root, 'external.mjs');
  writeFileSync(script, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'bad');`);
  f.file('.gitattributes', '*.mjs diff=unsafe\n');
  f.git('config', 'diff.unsafe.command', `node "${script}"`); f.git('config', 'diff.unsafe.textconv', `node "${script}"`);
  f.file('packages/core/a.mjs', 'two'); f.commit();
  assert.ok(planGit({ repo: f.root, base: f.base }).projects.includes('core'));
  assert.equal(existsSync(marker), false);
});

test('planning works from a subdirectory and ignores inherited Git locator overrides', t => {
  const f = fixture(t); f.file('packages/core/a.mjs', 'two'); f.commit();
  const previous = process.env.GIT_DIR;
  process.env.GIT_DIR = join(f.root, 'PRIVATE_MISSING_GIT_DIR');
  try { assert.deepEqual(planGit({ repo: join(f.root, 'packages'), base: f.base }).projects, ['core', 'web']); }
  finally { if (previous === undefined) delete process.env.GIT_DIR; else process.env.GIT_DIR = previous; }
});

test('a committed symlink policy is rejected without reading its target', t => {
  const f = fixture(t);
  const hash = f.git('hash-object', '-w', '--stdin');
  f.git('update-index', '--cacheinfo', `120000,${hash},change-scope.json`);
  f.git('commit', '-m', 'linked policy');
  assert.throws(() => planGit({ repo: f.root, base: f.base }), error => error.code === 'config-unavailable');
});

test('unrelated histories block merge-base mode while direct comparison remains explicit', t => {
  const f = fixture(t); const tree = f.git('rev-parse', 'HEAD^{tree}');
  const unrelated = f.git('commit-tree', tree, '-m', 'unrelated root');
  assert.throws(() => planGit({ repo: f.root, base: f.base, head: unrelated }), error => error.code === 'merge-base-unavailable');
  assert.equal(planGit({ repo: f.root, base: f.base, head: unrelated, comparison: 'direct' }).mode, 'empty');
});

test('multiple merge bases are rejected rather than choosing an arbitrary ancestor', t => {
  const f = fixture(t);
  f.file('packages/core/a.mjs', 'left'); const left = f.commit();
  f.git('switch', '-c', 'right', f.base); f.file('apps/other/b.mjs', 'right'); const right = f.commit();
  const tree = f.git('rev-parse', 'HEAD^{tree}');
  const first = f.git('commit-tree', tree, '-p', left, '-p', right, '-m', 'merge one');
  const second = f.git('commit-tree', tree, '-p', right, '-p', left, '-m', 'merge two');
  assert.throws(() => planGit({ repo: f.root, base: first, head: second }), error => error.code === 'ambiguous-merge-base');
});

test('a missing promisor blob is not fetched even when a complete local remote exists', t => {
  const f = fixture(t);
  const remote = mkdtempSync(join(tmpdir(), 'scope-promisor-'));
  t.after(() => rmSync(remote, { recursive: true, force: true }));
  const clone = spawnSync('git', ['clone', '--bare', '--no-hardlinks', f.root, remote], { encoding: 'utf8', windowsHide: true });
  assert.equal(clone.status, 0, 'fixture clone failed');
  f.git('config', 'remote.origin.url', remote);
  f.git('config', 'remote.origin.promisor', 'true');
  f.git('config', 'remote.origin.partialclonefilter', 'blob:none');
  const hash = f.git('rev-parse', 'HEAD:change-scope.json');
  assert.match(hash, /^[a-f0-9]{40}$/);
  unlinkSync(join(f.root, '.git', 'objects', hash.slice(0, 2), hash.slice(2)));
  assert.throws(() => planGit({ repo: f.root, base: f.base }), error => error.code === 'config-unavailable');
  assert.equal(existsSync(join(f.root, '.git', 'objects', hash.slice(0, 2), hash.slice(2))), false);
});
