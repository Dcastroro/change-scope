# Validation

The initial local suite passes on Windows with Node.js 24.20.0 and Git 2.55.0.
The GitHub CI matrix validates Ubuntu/Windows with Node.js 22/24; live results
are linked in the README. A release tag independently runs the same matrix
before source packaging and isolated publication.

## Evidence covered by tests

- Reverse dependencies, diamond graphs, nested/shared ownership and stable batches.
- Default all-project fallback, strict unmapped rejection and protected global inputs.
- Ignore precedence, duplicate changes, path boundaries and prototype-like IDs.
- Invalid metadata, cycles, missing edges, unsupported paths and resource overflow.
- Fixed-code CLI/library errors without raw input, path, ref or child-error leakage.
- Git renames across owners, deletions, divergent histories and committed head policy.
- Disabled external diff/text-conversion execution and ignored inherited Git locators.
- Unrelated/ambiguous merge bases fail closed; missing promisor blobs stay unfetched.
- Rejection of a symlink committed as policy and offline linked input directories.
- Seeded DAGs checked against an independent iterative closure oracle.
- A 10,000-project dependency chain with 100,000 changed paths: no recursion,
  10,000 selected IDs, 157 shards and no omitted/duplicated shard members.
- Pathological ownership overlap stops at the selector-match budget.
- Repository policy, source archive reproducibility, dirty/tag rejection and linked
  release destination rejection.

The scale test is a reproducible correctness regression, not a general throughput
benchmark or a production capacity promise. Limits apply together. No external
CI provider, remote service or real credential is needed for runtime tests.
