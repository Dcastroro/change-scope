# Planning model

The input is an explicit project graph and a list of repository-relative changed
paths. The output is a deterministic selection with one reason per project.

1. Validate the complete configuration, dependencies and acyclic graph.
2. Compile literal root/input/global/ignore selectors into a segment trie.
3. Deduplicate and classify paths: global, owned, ignored, then unmapped.
4. Select all projects for a global input or the default unmapped fallback.
   Strict `unmapped: error` blocks any unmapped path, including mixed changes.
5. Otherwise propagate direct changes through reverse dependency edges.
6. Batch the selected subgraph dependency-first, sorting each ready group.
7. Partition that order into shards of up to 64 IDs for a bounded CI matrix.

Direct seeds and reverse edges have stable ordering. The first breadth-first
parent gives a deterministic dependency explanation. A direct change takes
precedence over a propagated explanation; global/unmapped selection reasons
describe the conservative whole-graph decision. No changed path enters a report.

Nested roots and shared selectors can have multiple owners. Ignore rules never
hide an owned or global path. A directory selector matches both the exact
directory path (important for changed Git submodule entries) and descendants.

## Committed comparisons

Git mode resolves both refs to commits using `rev-parse --verify --end-of-options`.
The default comparison finds a unique merge base, then compares it with the head.
Multiple merge bases, absent objects and missing history block the plan. Direct
mode compares the two resolved commit trees without ancestry assumptions.

The policy is a regular blob in the head tree. Symlink policy entries and Git
submodule entries cannot become configuration files. `diff-tree` emits NUL-ended
paths with rename detection disabled, so a rename contributes both deletion and
addition paths. External diff drivers and text conversion are explicitly disabled.
Submodule entry changes are classified at their path; submodules are not traversed.

Git subprocesses have no shell, no credential prompts, no pager, no optional
locks and no allowed transport protocols. A small environment allowlist passes
execution, locale and home-directory paths; service credential variables and
inherited `GIT_*` overrides are not forwarded. Controlled Git variables are then
set explicitly. Lazy fetching and replace-object behavior
are disabled. The repository itself and the installed Git binary remain trusted
local execution context; this tool is not a Git sandbox.

The library never reads changed source contents. Offline mode reads only the
two explicitly supplied JSON files and rejects symlink input components.

## Built-in global inputs

The configured logical policy path (default `change-scope.json`), root
`package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`,
`pnpm-workspace.yaml`, `yarn.lock`, `bun.lock`, `bun.lockb`, and `.github/`.
Git mode supplies the selected policy's repository-relative path automatically.
For offline CLI policies stored elsewhere, declare that logical path explicitly
in `globalInputs`; the default logical policy name is `change-scope.json`.

## Resource limits and cost

| Resource | Bound |
| --- | --- |
| Configuration | 1,048,576 UTF-8 bytes |
| Projects / dependency edges | 10,000 / 100,000 |
| Selectors including built-ins | 50,000 |
| Change list / path content | 100,000 entries / 8,388,608 UTF-8 bytes |
| Individual path | 4,096 UTF-8 bytes / 128 segments |
| Selector matches across all paths | 1,000,000 |
| Git phase | 15 seconds total; each child shares the remaining deadline |
| Matrix shard | 64 projects; at most 157 shards for 10,000 projects |

Limits apply together, before planning succeeds; reaching one can prevent
reaching another. Offline JSON has an 8 MiB serialized file cap as well as the
planner's path-content cap. Malformed/non-UTF-8 Git paths, control characters,
backslashes, colons, glob metacharacters, absolute paths and traversal segments
are rejected. Paths are case-sensitive and are not Unicode-normalized.

Trie lookup is proportional to path depth plus selector matches. Graph work is
linear in nodes and edges, with sorting of ready groups for stable batches.
Memory stores the graph, trie, unique paths and result, within the input bounds.
No recursive traversal of project dependencies is used.

## Boundaries

This is an impact-selection policy, not an import analyzer or build cache.
Missing declared dependencies can omit consumers; there is no automatic proof
that the graph is complete. A leaf change selects the leaf, without selecting
unchanged prerequisites. Batches order affected edges; shards do not schedule
dependencies between independent CI jobs. Runtime inputs, generated artifacts,
dirty files and external services require explicit policy outside this tool.

Git operation failures use fixed codes and suppress child stderr. They never
become an empty success. Configured IDs and commit hashes remain visible by
design; untrusted repository files are never turned into executable commands.

References: [Git diff](https://git-scm.com/docs/git-diff),
[revision verification](https://git-scm.com/docs/git-rev-parse),
[Git environment](https://git-scm.com/docs/git),
[GitHub matrix syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax).
