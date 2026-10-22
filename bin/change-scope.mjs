#!/usr/bin/env node
import { openSync, fstatSync, readSync, closeSync, lstatSync } from 'node:fs';
import { resolve, parse, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { planImpact, planGit, ScopeError, LIMITS } from '../src/index.mjs';
import { fail, jsonText } from '../src/policy.mjs';

const VERSION = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
const HELP = `Change Scope ${VERSION}
Plan affected monorepo projects without running their commands.

  change-scope plan --base origin/main [--head HEAD] [--repo .]
  change-scope plan --config examples/monorepo.json --changes examples/changes.json

Options:
  --config FILE              Default: change-scope.json; committed HEAD config in Git mode
  --comparison merge-base|direct   Default: merge-base
  --format text|json|matrix|summary  Default: text; summary contains counts only
  --fail-if-affected         Exit 1 for a valid nonempty plan
  --help                    Show help
  --version                 Show version

Exit codes: 0 success, 1 affected (opt-in), 2 invalid input or unavailable Git objects.
`;

function readJson(path, limit) {
  let descriptor;
  try {
    const absolute = resolve(path);
    let current = parse(absolute).root;
    for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
      current = join(current, part);
      if (lstatSync(current).isSymbolicLink()) fail('input-file');
    }
    descriptor = openSync(absolute, 'r');
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > limit) fail('input-file');
    const buffer = Buffer.alloc(limit + 1);
    let size = 0, count;
    while (size < buffer.length && (count = readSync(descriptor, buffer, size, buffer.length - size, null)) > 0) size += count;
    if (size > limit) fail('input-limit');
    return jsonText(buffer.subarray(0, size), limit);
  } catch (error) { if (error instanceof ScopeError) throw error; fail('input-file'); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--version') console.log(VERSION);
  else if (args.length === 0 || (args.length === 1 && args[0] === '--help')) process.stdout.write(HELP);
  else {
    if (args.shift() !== 'plan') fail('usage');
    const options = new Map();
    for (let index = 0; index < args.length; index += 1) {
      const key = args[index];
      if (options.has(key)) fail('usage');
      if (key === '--fail-if-affected') options.set(key, true);
      else if (['--config', '--changes', '--base', '--head', '--repo', '--comparison', '--format'].includes(key)) {
        const value = args[++index];
        if (typeof value !== 'string' || !value || value.startsWith('--')) fail('usage');
        options.set(key, value);
      } else fail('usage');
    }
    const format = options.get('--format') ?? 'text';
    if (!['text', 'json', 'matrix', 'summary'].includes(format)) fail('usage');
    const configPath = options.get('--config') ?? 'change-scope.json';
    let plan;
    if (options.has('--changes')) {
      if (['--base', '--head', '--repo', '--comparison'].some(key => options.has(key))) fail('usage');
      plan = planImpact(readJson(configPath, LIMITS.configBytes), readJson(options.get('--changes'), LIMITS.changeBytes));
    } else {
      if (!options.has('--base')) fail('usage');
      plan = planGit({ repo: options.get('--repo') ?? '.', base: options.get('--base'), head: options.get('--head') ?? 'HEAD', configPath, comparison: options.get('--comparison') ?? 'merge-base' });
    }
    if (format === 'json') console.log(JSON.stringify(plan, null, 2));
    else if (format === 'summary') console.log(JSON.stringify({ version: plan.version, ok: plan.ok, mode: plan.mode, totals: plan.totals, batchCount: plan.batches.length, shardCount: plan.matrix.include.length }));
    else if (format === 'matrix') console.log(JSON.stringify(plan.matrix));
    else {
      console.log(`Change Scope: ${plan.mode}; ${plan.totals.selected}/${plan.totals.projects} projects selected.`);
      console.log(`Changes: ${plan.totals.changes}; global: ${plan.totals.global}; unmapped: ${plan.totals.unmapped}; ignored: ${plan.totals.ignored}.`);
      for (const reason of plan.reasons) console.log(`  ${reason.project}: ${reason.kind}${reason.via ? ` via ${reason.via}` : ''}`);
    }
    if (options.has('--fail-if-affected') && plan.projects.length) process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify({ version: 1, ok: false, error: { code: error instanceof ScopeError ? error.code : 'internal-error' } }));
  process.exitCode = 2;
}
