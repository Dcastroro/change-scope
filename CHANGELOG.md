# Changelog

## 0.1.0 — 2026-10-15

- Explicit monorepo ownership with literal prefix-trie matching and shared inputs.
- Iterative reverse dependency propagation, deterministic explanations and batches.
- Conservative global/unmapped handling with an optional strict ownership policy.
- Bounded CI matrix shards without losing selected projects.
- Committed Git comparison with head-policy selection, merge-base/direct modes,
  rename/deletion coverage and disabled external diff/text conversion.
- Value-free errors and reports that omit changed paths, source content and raw refs.
- Seeded graph-oracle and 10,000-project / 100,000-path regressions.
- Cross-platform CI and verified source releases with no custom service credentials.
