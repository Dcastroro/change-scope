import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpact, ScopeError, LIMITS } from '../src/index.mjs';

const config = () => ({ version: 1, projects: [
  { id: 'core', root: 'packages/core', inputs: ['shared/types/'] },
  { id: 'ui', root: 'packages/ui', dependsOn: ['core'] },
  { id: 'api', root: 'apps/api', dependsOn: ['core'] },
  { id: 'web', root: 'apps/web', dependsOn: ['ui', 'api'] },
  { id: 'docs', root: 'apps/docs' },
], ignoredInputs: ['docs/', 'README.md'] });
const throws = (fn, code) => assert.throws(fn, error => error instanceof ScopeError && error.code === code && error.message === code);

test('propagates reverse dependencies and creates deterministic dependency batches', () => {
  const plan = planImpact(config(), ['packages/core/src/index.mjs', 'docs/guide.md']);
  assert.deepEqual(plan.projects, ['core', 'api', 'ui', 'web']);
  assert.deepEqual(plan.batches, [['core'], ['api', 'ui'], ['web']]);
  assert.deepEqual(plan.reasons, [
    { project: 'core', kind: 'direct' }, { project: 'api', kind: 'dependent', via: 'core' },
    { project: 'ui', kind: 'dependent', via: 'core' }, { project: 'web', kind: 'dependent', via: 'api' },
  ]);
  assert.deepEqual(plan.matrix, { include: [{ shard: 1, projects: ['core', 'api', 'ui', 'web'] }] });
  assert.equal(plan.totals.ignored, 1);
});

test('a leaf change does not select unchanged prerequisites', () => {
  assert.deepEqual(planImpact(config(), ['apps/web/index.mjs']).projects, ['web']);
});

test('exact files and directory prefixes have segment boundaries', () => {
  const c = config(); c.projects[0].inputs = ['shared/exact.json'];
  assert.equal(planImpact(c, ['packages/core-other/x']).mode, 'all');
  assert.equal(planImpact(c, ['shared/exact.json.extra']).mode, 'all');
  assert.equal(planImpact(c, ['shared/exact.json']).mode, 'selective');
  assert.equal(planImpact(c, ['packages/core']).mode, 'selective');
});

test('shared inputs propagate like project roots and overlapping roots select all owners', () => {
  const c = config(); c.projects.push({ id: 'nested', root: 'packages/core/nested' });
  assert.ok(planImpact(c, ['packages/core/nested/x']).projects.includes('nested'));
  assert.deepEqual(planImpact(config(), ['shared/types/index.d.ts']).projects, ['core', 'api', 'ui', 'web']);
});

test('unknown ownership conservatively selects every project, or blocks strict policy', () => {
  const c = config();
  const plan = planImpact(c, ['new-package/index.mjs']);
  assert.equal(plan.mode, 'all'); assert.equal(plan.projects.length, c.projects.length);
  assert.equal(plan.totals.unmapped, 1);
  c.unmapped = 'error';
  throws(() => planImpact(c, ['private-unmapped-input']), 'unmapped-change');
});

test('global/config/lock/workflow changes override ignore rules and strict unknown handling', () => {
  const c = config(); c.ignoredInputs.push('.github/', 'packages/'); c.unmapped = 'error';
  for (const path of ['package.json', 'pnpm-lock.yaml', '.github/workflows/test.yml', 'change-scope.json']) {
    assert.equal(planImpact(c, [path]).mode, 'all');
  }
  assert.equal(planImpact(c, ['packages/core/x']).mode, 'selective');
  assert.equal(planImpact(c, ['custom/policy.json'], { configPath: 'custom/policy.json' }).mode, 'all');
});

test('explicit ignored changes and an empty change list produce empty plans', () => {
  assert.equal(planImpact(config(), ['README.md', 'docs/guide.md']).mode, 'empty');
  assert.deepEqual(planImpact(config(), []).matrix, { include: [] });
});

test('duplicate paths are counted once and input order does not alter output', () => {
  const c = config(), paths = ['apps/web/x', 'packages/core/x', 'packages/core/x'];
  const first = planImpact(c, paths);
  c.projects.reverse();
  assert.deepEqual(planImpact(c, [...paths].reverse()), first);
  assert.equal(first.totals.changes, 2);
});

test('reports omit path contents, ignored names, roots and arbitrary input values', () => {
  const marker = 'PRIVATE_INPUT_SENTINEL';
  const plan = planImpact(config(), [`apps/web/${marker}`, `docs/${marker}`]);
  const text = JSON.stringify(plan);
  assert.equal(text.includes(marker), false);
  assert.equal(text.includes('apps/web'), false);
});

test('rejects cycles, unknown dependencies, duplicate IDs and malformed graph data', () => {
  const cycle = config(); cycle.projects[0].dependsOn = ['web'];
  throws(() => planImpact(cycle, []), 'dependency-cycle');
  const missing = config(); missing.projects[0].dependsOn = ['missing'];
  throws(() => planImpact(missing, []), 'unknown-dependency');
  const duplicate = config(); duplicate.projects.push(duplicate.projects[0]);
  throws(() => planImpact(duplicate, []), 'invalid-project');
  const duplicates = config(); duplicates.projects[1].dependsOn = ['core', 'core'];
  throws(() => planImpact(duplicates, []), 'invalid-dependency');
  for (const extra of [{ command: 'PRIVATE_SENTINEL' }, { globalInputs: 'bad' }, { projects: [] }, { version: 2 }, { unmapped: 'ignore' }]) {
    throws(() => planImpact({ ...config(), ...extra }, []), 'invalid-config');
  }
  for (const field of ['dependsOn', 'inputs']) {
    const invalid = config(); invalid.projects[0][field] = null;
    throws(() => planImpact(invalid, []), field === 'dependsOn' ? 'invalid-dependency' : 'invalid-config');
  }
  throws(() => planImpact({ ...config(), ignoredInputs: null }, []), 'invalid-config');
});

test('rejects unsafe or unsupported paths with value-free errors', () => {
  for (const path of ['/absolute', '../escape', 'a/../b', 'C:/private', 'a\\b', 'a//b', './x', 'a\nx', 'a/*', 'a/', '\ud800', 'a/'.repeat(129)+'x']) {
    throws(() => planImpact(config(), [path]), 'invalid-path');
  }
  const c = config(); c.projects[0].root = '.';
  throws(() => planImpact(c, []), 'invalid-path');
});

test('Map-based graph keys do not inherit object prototype properties', () => {
  const c = { version: 1, projects: [{ id: 'constructor', root: 'a' }, { id: 'other', root: 'b', dependsOn: ['constructor'] }] };
  assert.deepEqual(planImpact(c, ['a/x']).projects, ['constructor', 'other']);
});

test('rejects input, selector, file and graph resource overflows', () => {
  throws(() => planImpact(config(), Array(LIMITS.changes + 1).fill('apps/web/x')), 'change-limit');
  throws(() => planImpact(config(), ['a'.repeat(LIMITS.pathBytes + 1)]), 'invalid-path');
  const c = config(); c.projects[0].inputs = Array(LIMITS.selectors).fill('x');
  throws(() => planImpact(c, []), 'selector-limit');
  const big = { version: 1, projects: Array.from({ length: LIMITS.projects + 1 }, (_, i) => ({ id: `p${i}`, root: `p${i}` })) };
  throws(() => planImpact(big, []), 'project-limit');
  const edges = config(); edges.projects[0].dependsOn = Array(LIMITS.edges + 1).fill('core');
  throws(() => planImpact(edges, []), 'edge-limit');
  const bytes = config(); bytes.projects[0].inputs = Array(400).fill('x'.repeat(3000));
  throws(() => planImpact(bytes, []), 'config-limit');
});

test('limits overlapping selector matches instead of unbounded expansion', () => {
  const c = { version: 1, projects: Array.from({ length: 10_000 }, (_, i) => ({ id: `p${i}`, root: 'shared' })) };
  throws(() => planImpact(c, Array.from({ length: 101 }, (_, i) => `shared/f${i}`)), 'match-limit');
});

test('10,000-project chain and 100,000 paths stay iterative and shard without dropping projects', { timeout: 15000 }, () => {
  const c = { version: 1, projects: Array.from({ length: 10_000 }, (_, i) => ({ id: `p${i}`, root: `p${i}`, dependsOn: i ? [`p${i - 1}`] : [] })) };
  const plan = planImpact(c, Array.from({ length: 100_000 }, (_, i) => `p0/src/f${i}`));
  assert.equal(plan.projects.length, 10_000); assert.equal(plan.totals.changes, 100_000);
  assert.equal(plan.batches.length, 10_000);
  assert.equal(plan.matrix.include.length, 157);
  assert.ok(plan.matrix.include.every(shard => shard.projects.length <= 64));
  assert.deepEqual(plan.matrix.include.flatMap(shard => shard.projects), plan.projects);
});

test('seeded DAG cases agree with an independent transitive-closure oracle', () => {
  let state = 2718;
  const random = () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  for (let round = 0; round < 40; round += 1) {
    const projects = Array.from({ length: 60 }, (_, i) => ({ id: `p${i}`, root: `p${i}`, dependsOn: Array.from({ length: i }, (_, n) => n).filter(() => random() < .06).map(n => `p${n}`) }));
    const seeds = projects.filter(() => random() < .05).map(p => p.id);
    const expected = new Set(seeds);
    let changed;
    do {
      changed = false;
      for (const p of projects) if (!expected.has(p.id) && p.dependsOn.some(id => expected.has(id))) { expected.add(p.id); changed = true; }
    } while (changed);
    const plan = planImpact({ version: 1, projects }, seeds.map(id => `${id}/file`));
    assert.deepEqual([...plan.projects].sort(), [...expected].sort());
    for (const p of projects) for (const dep of p.dependsOn) if (expected.has(dep) && expected.has(p.id)) assert.ok(plan.projects.indexOf(dep) < plan.projects.indexOf(p.id));
  }
});
