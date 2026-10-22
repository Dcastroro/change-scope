import test from 'node:test';
import assert from 'node:assert/strict';
import { planImpact, ScopeError, LIMITS } from '../src/index.mjs';

const config = (dependsOn) => ({
  version: 1,
  projects: [
    { id: 'core', root: 'packages/core' },
    { id: 'ui', root: 'packages/ui' },
    { id: 'web', root: 'apps/web', dependsOn },
  ],
});
function rejected(dependsOn, code = 'invalid-dependency') {
  assert.throws(
    () => planImpact(config(dependsOn), ['packages/core/index.mjs']),
    (error) =>
      error instanceof ScopeError &&
      error.code === code &&
      error.message === code,
  );
}

for (const [name, dependencies] of [
  ['only entry', new Array(1)],
  ['leading entry', [, 'core']],
  ['middle entry', ['core', , 'ui']],
  ['trailing entry', ['core', ,]],
]) {
  test(`dependency holes fail with a fixed diagnostic: ${name}`, () =>
    rejected(dependencies));
}

test('inherited entries cannot fill a dependency hole', () => {
  const dependencies = new Array(1);
  const prototype = Object.create(Array.prototype);
  prototype[0] = 'core';
  Object.setPrototypeOf(dependencies, prototype);
  rejected(dependencies);
});

test('an inherited getter is rejected without reading its value', () => {
  const dependencies = new Array(1);
  const prototype = Object.create(Array.prototype);
  Object.defineProperty(prototype, '0', {
    get() {
      throw new Error('PRIVATE_FICTIONAL_GETTER');
    },
  });
  Object.setPrototypeOf(dependencies, prototype);
  rejected(dependencies);
});

test('the edge limit is checked before traversing an oversized sparse array', () => {
  rejected(new Array(LIMITS.edges + 1), 'edge-limit');
});

test('ordinary own entries remain valid even with an unused inherited index', () => {
  const dependencies = ['core'];
  const prototype = Object.create(Array.prototype);
  prototype[0] = 'ui';
  Object.setPrototypeOf(dependencies, prototype);
  const plan = planImpact(config(dependencies), ['packages/core/index.mjs']);
  assert.deepEqual(plan.projects, ['core', 'web']);
  assert.deepEqual(plan.batches, [['core'], ['web']]);
  assert.equal(plan.reasons[1].via, 'core');
});

test('empty and omitted dependency lists still select only the changed project', () => {
  for (const dependencies of [[], undefined]) {
    assert.deepEqual(
      planImpact(config(dependencies), ['packages/core/index.mjs']).projects,
      ['core'],
    );
  }
});
