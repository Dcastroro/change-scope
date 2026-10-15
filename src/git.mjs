import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { LIMITS, fail, pathParts, jsonText } from './policy.mjs';
import { planImpact } from './planner.mjs';

function revision(value) {
  if (typeof value !== 'string' || !value || value.length > 256 || /[^\x21-\x7e]/.test(value)) fail('invalid-revision');
  return value;
}

/** Reads committed objects only; no checkout, fetch, hooks, filters, or submodule traversal. */
export function planGit({ repo = '.', base, head = 'HEAD', configPath = 'change-scope.json', comparison = 'merge-base' } = {}) {
  if (typeof repo !== 'string' || !repo || repo.includes('\0')) fail('invalid-repository');
  revision(base); revision(head); pathParts(configPath);
  if (!['merge-base', 'direct'].includes(comparison)) fail('invalid-comparison');
  const deadline = Date.now() + LIMITS.gitMilliseconds;
  // Pass execution/locale/home paths, rather than forwarding service credentials or Git overrides.
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'SYSTEMDRIVE', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toUpperCase())));
  Object.assign(env, { GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_ALLOW_PROTOCOL: '' });
  const run = (args, maxBuffer = LIMITS.changeBytes, code = 'git-operation') => {
    const timeout = deadline - Date.now();
    if (timeout <= 0) fail('git-limit');
    const result = spawnSync('git', ['--no-pager', '--literal-pathspecs', '-c', 'core.fsmonitor=false', '-c', 'diff.relative=false', '-c', 'protocol.allow=never', ...args], {
      cwd: resolve(repo), env, timeout, maxBuffer, encoding: 'buffer', windowsHide: true,
    });
    if (result.error || result.status !== 0) fail(code);
    return result.stdout;
  };
  const commit = ref => {
    const value = run(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], 4096, 'revision-unavailable').toString('utf8').trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value)) fail('git-output');
    return value;
  };
  const baseCommit = commit(base), headCommit = commit(head);
  let from = baseCommit;
  if (comparison === 'merge-base') {
    const bases = run(['merge-base', '--all', baseCommit, headCommit], 4096, 'merge-base-unavailable').toString('utf8').trim().split('\n');
    if (bases.length !== 1 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(bases[0])) fail('ambiguous-merge-base');
    from = bases[0];
  }
  const entries = run(['ls-tree', '--full-tree', '-z', headCommit, '--', configPath], 8192, 'config-unavailable').toString('utf8').split('\0').filter(Boolean);
  if (entries.length !== 1 || !/^100(?:644|755) blob [a-f0-9]+\t/.test(entries[0]) || entries[0].slice(entries[0].indexOf('\t') + 1) !== configPath) fail('config-unavailable');
  const config = jsonText(run(['cat-file', 'blob', `${headCommit}:${configPath}`], LIMITS.configBytes, 'config-unavailable'), LIMITS.configBytes);
  const bytes = run(['diff-tree', '--no-commit-id', '-r', '--name-only', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', from, headCommit, '--']);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { fail('git-output'); }
  if (text && !text.endsWith('\0')) fail('git-output');
  const changes = text ? text.slice(0, -1).split('\0') : [];
  const plan = planImpact(config, changes, { configPath });
  return { ...plan, comparison: { mode: comparison, base: baseCommit, head: headCommit, from } };
}
