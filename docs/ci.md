# CI integration

Vendor a reviewed Change Scope release into `tools/change-scope` in the
repository you want to analyze. The monorepo owns its `change-scope.json` policy.
The example below selects work for a pull request and passes shards to your
existing test runner. It does not download or execute an unpinned tool version.

```yaml
name: Affected projects
on: pull_request
permissions:
  contents: read
jobs:
  plan:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      matrix: ${{ steps.scope.outputs.matrix }}
      selected: ${{ steps.scope.outputs.selected }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1
        with:
          node-version: 24
          package-manager-cache: false
      - id: scope
        env:
          BASE_COMMIT: ${{ github.event.pull_request.base.sha }}
          HEAD_COMMIT: ${{ github.event.pull_request.head.sha }}
        shell: bash
        run: |
          node tools/change-scope/bin/change-scope.mjs plan --base "$BASE_COMMIT" --head "$HEAD_COMMIT" --format json > scope-plan.json
          node --input-type=module <<'JS'
          import {readFileSync, appendFileSync} from 'node:fs';
          const plan = JSON.parse(readFileSync('scope-plan.json', 'utf8'));
          if (!plan.ok) process.exit(2);
          appendFileSync(process.env.GITHUB_OUTPUT,
            `matrix=${JSON.stringify(plan.matrix)}\nselected=${plan.totals.selected}\n`);
          JS
  test:
    needs: plan
    if: needs.plan.outputs.selected != '0'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    strategy:
      fail-fast: false
      max-parallel: 4
      matrix: ${{ fromJSON(needs.plan.outputs.matrix) }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1
        with:
          ref: ${{ github.event.pull_request.head.sha }}
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1
        with:
          node-version: 24
          package-manager-cache: false
      - name: Run your existing selected-project consumer
        env:
          CHANGE_SCOPE_PROJECTS: ${{ toJSON(matrix.projects) }}
        run: node ci/test-selected.mjs
```

Supply `ci/test-selected.mjs` in your monorepo: it reads the JSON array from
`CHANGE_SCOPE_PROJECTS`, maps those logical IDs to your build system, installs
its required dependencies and runs its tests. This repository intentionally
does not invent build commands for another repository. Keep IDs as data passed
through environment/argument arrays; avoid interpolating them into shell code.
Never pass a JSON error object to matrix expansion or convert planner failure
into a successful empty list.

The sample uses ordinary read-only pull-request jobs. Do not switch to
`pull_request_target` or provide deployment/service credentials while running
untrusted changes. A PR can modify its graph and tests: ownership checks are an
optimization, not authorization. Protect policy changes with review and retain
a full-suite lane for release/main or periodic validation.

Shards are balanced by count, not estimated duration. At most 64 IDs enter a
shard; all affected IDs appear once. A full 10,000-project plan has 157 shards,
within GitHub's 256-job matrix cap. If you add more matrix dimensions, account
for their multiplication. Batches in the full JSON report are available to
schedulers that need dependency-aware stages; CI shards run independently.

Task Relay can run Change Scope as a declared preparation task. Its JSON result
should be consumed explicitly by your build integration; Change Scope never
constructs or executes arbitrary project commands.
