# Verification logs

21 October 2026. Node 24.21.0, PNPM 12.4.2, Podman 5.8.9.
Each log preserves the command, output, UTC timestamps, and exit status.

| Log | Result |
| --- | --- |
| [001-lint.log](001-lint.log) | Pass |
| [002-typecheck.log](002-typecheck.log) | Both apps pass; cache bypassed |
| [003-test.log](003-test.log) | 207 pass, eight database cases skipped |
| [004-compose-build.log](004-compose-build.log) | Both images build |
| [005-compose-up.log](005-compose-up.log) | Fails: automatic health checks time out |
| [006-scylla-test.log](006-scylla-test.log) | All 215 pass |

The separate restart check uses compiled handlers, mocked complete HTML, and
owned Scylla records. GET and repeated import return the same saved data before
and after a native backend restart, and through the published container backend.
Temporary records and native processes are cleaned up.