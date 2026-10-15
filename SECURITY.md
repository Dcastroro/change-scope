# Security boundaries

Change Scope requires no service credentials and sends no network requests.
Offline mode reads explicit bounded JSON inputs. Git mode uses local committed
objects with transports blocked, a shared timeout and bounded child output.
No source scripts, diff drivers, text-conversion filters or submodule commands
are executed. No working-tree source contents are scanned or copied into plans.

Reports contain configured project IDs, counts, dependency explanations and
resolved commit hashes. Changed filenames, file contents, user ref strings,
local paths and Git stderr are omitted. Fixed error codes block unavailable or
invalid inputs; errors do not silently select zero projects. Library errors
have fixed messages; callers control whether they display ordinary stack traces.

Use a trusted Git installation and a repository/local filesystem you control.
Repository Git configuration and filesystem races are outside a sandboxing
guarantee. Offline input symlinks are rejected, but concurrent filesystem
mutation is not supported. Missing history/objects must be supplied by your
checkout process; no automatic fetching or credential prompts are allowed.

A selective plan is only as complete as its declared dependency graph. Missing
edges, incorrect ignore selectors and malicious policy edits can reduce its
accuracy. Review policy changes, preserve full-suite validation for important
branches and keep deployment authorization independent of the planner.

Repository credential checks are bounded heuristics, not a guarantee that all
possible secrets are recognized. Use fictional fixtures. Do not attach private
configs, raw Git logs or credential-bearing paths to public issues. Report a
security concern using the contact channel linked on the maintainer's GitHub
profile, with a minimal fictional reproduction.
