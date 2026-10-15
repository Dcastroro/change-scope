# Contributing

Use Node.js 22+ and Git 2.43+. Run `npm ci --ignore-scripts`,
`npm run repo:check`, `npm run check` and `npm run demo` before proposing changes.
There are no runtime or development package dependencies.

Keep graph operations iterative and bounded. Add regression coverage for
ownership, conservative fallbacks, path boundaries, Git behavior or privacy when
changing those guarantees. Prefer a seeded independent oracle to tests that
merely mirror implementation. Use temporary repositories with fictional data
and a non-personal fixture identity; never rely on a developer's Git config.

Preserve fixed-code diagnostics, argument-array subprocess invocation, explicit
Git flags and the shared resource budgets. Keep the limits table and matrix
contract synchronized with implementation. Do not turn repository input into
commands or introduce automatic network operations.

Follow [RELEASING.md](RELEASING.md) for a clean, reviewed, tag-based source release.
