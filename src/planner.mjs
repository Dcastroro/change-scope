import { LIMITS, fail, pathParts, objectKeys } from './policy.mjs';

const GLOBAL_INPUTS = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'yarn.lock', 'bun.lock', 'bun.lockb', '.github/'];
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;

function node() { return { children: new Map(), directory: new Set(), exact: new Set() }; }
function addRule(trie, selector, owner) {
  let current = trie;
  for (const part of pathParts(selector, true)) {
    if (!current.children.has(part)) current.children.set(part, node());
    current = current.children.get(part);
  }
  (selector.endsWith('/') ? current.directory : current.exact).add(owner);
}

function batchesFor(ids, projects) {
  const selected = new Set(ids);
  const counts = new Map(ids.map(id => [id, projects.get(id).dependencies.filter(dependency => selected.has(dependency)).length]));
  let ready = ids.filter(id => counts.get(id) === 0).sort();
  const batches = [];
  let visited = 0;
  while (ready.length) {
    batches.push(ready); visited += ready.length;
    const next = [];
    for (const id of ready) {
      for (const dependent of projects.get(id).dependents) {
        if (!selected.has(dependent)) continue;
        const remaining = counts.get(dependent) - 1;
        counts.set(dependent, remaining);
        if (remaining === 0) next.push(dependent);
      }
    }
    ready = next.sort();
  }
  if (visited !== ids.length) fail('dependency-cycle');
  return batches;
}

function compile(config, configPath) {
  objectKeys(config, ['version', 'projects', 'globalInputs', 'ignoredInputs', 'unmapped']);
  if (config.version !== 1 || !Array.isArray(config.projects) || config.projects.length === 0) fail('invalid-config');
  if (config.projects.length > LIMITS.projects) fail('project-limit');
  if (config.unmapped !== undefined && !['all', 'error'].includes(config.unmapped)) fail('invalid-config');
  const projects = new Map();
  const trie = node();
  let edges = 0, selectors = 0, inputBytes = 0;
  const account = value => {
    inputBytes += Buffer.byteLength(value);
    if (inputBytes > LIMITS.configBytes) fail('config-limit');
  };
  const add = (selector, owner) => {
    if (++selectors > LIMITS.selectors) fail('selector-limit');
    pathParts(selector, true); account(selector);
    addRule(trie, selector, owner);
  };
  const rules = (values, owner) => {
    if (!Array.isArray(values)) fail('invalid-config');
    if (values.length > LIMITS.selectors - selectors) fail('selector-limit');
    for (const value of values) add(value, owner);
  };
  for (const item of config.projects) {
    objectKeys(item, ['id', 'root', 'dependsOn', 'inputs']);
    if (typeof item.id !== 'string' || !idPattern.test(item.id) || projects.has(item.id)) fail('invalid-project');
    account(item.id);
    pathParts(item.root);
    const dependencies = item.dependsOn === undefined ? [] : item.dependsOn;
    if (!Array.isArray(dependencies)) fail('invalid-dependency');
    edges += dependencies.length;
    if (edges > LIMITS.edges) fail('edge-limit');
    if (dependencies.some(id => typeof id !== 'string' || !idPattern.test(id))
      || new Set(dependencies).size !== dependencies.length) fail('invalid-dependency');
    for (const dependency of dependencies) account(dependency);
    projects.set(item.id, { dependencies: [...dependencies].sort(), dependents: [] });
    add(`${item.root}/`, item.id);
    rules(item.inputs === undefined ? [] : item.inputs, item.id);
  }
  const ids = [...projects.keys()].sort();
  for (const id of ids) {
    for (const dependency of projects.get(id).dependencies) {
      if (!projects.has(dependency)) fail('unknown-dependency');
      projects.get(dependency).dependents.push(id);
    }
  }
  batchesFor(ids, projects);
  if (config.globalInputs !== undefined && !Array.isArray(config.globalInputs)) fail('invalid-config');
  rules(GLOBAL_INPUTS, null); add(configPath, null);
  rules(config.globalInputs ?? [], null);
  rules(config.ignoredInputs === undefined ? [] : config.ignoredInputs, false);
  if (Buffer.byteLength(JSON.stringify(config)) > LIMITS.configBytes) fail('config-limit');
  return { projects, ids, trie, unmapped: config.unmapped ?? 'all' };
}

/** Pure, deterministic impact planning. Reports contain configured IDs, never changed paths. */
export function planImpact(config, changes, { configPath = 'change-scope.json' } = {}) {
  pathParts(configPath);
  const graph = compile(config, configPath);
  if (!Array.isArray(changes)) fail('invalid-changes');
  if (changes.length > LIMITS.changes) fail('change-limit');
  const paths = new Map(); let bytes = 0;
  for (const path of changes) {
    const parts = pathParts(path);
    bytes += Buffer.byteLength(path);
    if (bytes > LIMITS.changeBytes) fail('change-limit');
    paths.set(path, parts);
  }
  const direct = new Set();
  let ignored = 0, unmapped = 0, global = 0, matches = 0;
  for (const parts of paths.values()) {
    let current = graph.trie;
    const owners = new Set();
    const collect = set => {
      for (const owner of set) {
        if (++matches > LIMITS.matches) fail('match-limit');
        owners.add(owner);
      }
    };
    for (let index = 0; index < parts.length; index += 1) {
      current = current.children.get(parts[index]);
      if (!current) break;
      collect(current.directory);
      if (index === parts.length - 1) collect(current.exact);
    }
    const owned = [...owners].filter(owner => typeof owner === 'string');
    if (owners.has(null)) global += 1;
    else if (owned.length) for (const id of owned) direct.add(id);
    else if (owners.has(false)) ignored += 1;
    else unmapped += 1;
  }
  if (unmapped && graph.unmapped === 'error') fail('unmapped-change');
  const all = global > 0 || unmapped > 0;
  const reasons = new Map();
  const queue = all ? [...graph.ids] : [...direct].sort();
  for (const id of queue) reasons.set(id, { project: id, kind: all ? (global ? 'global' : 'unmapped') : 'direct' });
  for (let index = 0; index < queue.length; index += 1) {
    const id = queue[index];
    for (const dependent of graph.projects.get(id).dependents) {
      if (reasons.has(dependent)) continue;
      reasons.set(dependent, { project: dependent, kind: 'dependent', via: id });
      queue.push(dependent);
    }
  }
  const batches = batchesFor([...reasons.keys()], graph.projects);
  const projects = batches.flat();
  return {
    version: 1, ok: true, mode: all ? 'all' : projects.length ? 'selective' : 'empty',
    totals: { projects: graph.ids.length, changes: paths.size, direct: direct.size, selected: projects.length, global, ignored, unmapped },
    projects, batches, reasons: projects.map(id => reasons.get(id)),
    matrix: { include: Array.from({ length: Math.ceil(projects.length / 64) }, (_, index) => ({ shard: index + 1, projects: projects.slice(index * 64, (index + 1) * 64) })) },
  };
}
