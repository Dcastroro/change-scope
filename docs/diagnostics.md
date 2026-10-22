# Diagnostics and exit codes

`validate` exits `0` with a count-only JSON result for a valid local policy.
It accepts only `--config`; planning flags return `usage`. Validation failures
use exit `2` and the same diagnostic codes as planning.

Planning returns exit `0`, including a valid empty plan. With
`--fail-if-affected`, a nonempty valid plan returns `1`. Every input/operation
failure returns `2` and a JSON object such as:

```json
{"version":1,"ok":false,"error":{"code":"merge-base-unavailable"}}
```

Errors use JSON even in text/matrix mode. Consumers must check process exit
status before reading a successful plan or matrix. CLI diagnostics suppress
source values, filenames, ref strings, filesystem paths and Git stderr.

| Code | Action |
| --- | --- |
| `usage` | Check command options; Git and offline modes cannot be mixed. |
| `input-file`, `input-limit`, `invalid-json` | Supply regular, unlinked UTF-8 JSON files within the byte caps. |
| `invalid-config`, `invalid-project`, `invalid-dependency` | Correct the version-1 policy fields, IDs, array types and duplicate definitions. |
| `invalid-path` | Use literal repository-relative forward-slash paths within length/depth limits. |
| `unknown-dependency`, `dependency-cycle` | Fix the complete graph, including projects unaffected by this change. |
| `unmapped-change` | Declare ownership/global inputs or an intentional ignore, or use the conservative `all` policy. |
| `config-limit`, `project-limit`, `edge-limit`, `selector-limit`, `change-limit`, `match-limit` | Reduce the input or split the planning domain; overlap can consume the match budget. |
| `invalid-repository`, `invalid-revision`, `invalid-comparison` | Correct the Git request. Ref input is never interpreted as command options. |
| `revision-unavailable` | Make both commits available locally before planning; the tool never fetches. |
| `merge-base-unavailable`, `ambiguous-merge-base` | Supply adequate shared history; use explicit direct comparison only when that matches your intended policy. |
| `config-unavailable` | Commit a regular policy file at the selected head path; missing/oversized blobs and symlink policies are rejected. |
| `git-operation`, `git-output`, `git-limit` | Check the trusted Git installation, repository, supported filenames and bounded output/deadline. |
| `internal-error` | Stop the pipeline and report a minimal fictional reproduction. |

Library functions throw `ScopeError` for handled validation/operation failures;
the fixed `code` and message are intended for callers. Ordinary JavaScript
stack traces remain under the caller's control.
