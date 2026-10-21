# Verification logs

21 October 2026. Node 24.21.0, PNPM 12.4.2, Podman 5.8.9.
Logs 001–006 preserve commands, output, UTC timestamps, and exit status.
Log 007 is the candidate's terminal capture, saved unchanged with local timestamps.

| Log | Result |
| --- | --- |
| [001-lint.log](001-lint.log) | Pass |
| [002-typecheck.log](002-typecheck.log) | Both apps pass; cache bypassed |
| [003-test.log](003-test.log) | 207 pass, eight database cases skipped |
| [004-compose-build.log](004-compose-build.log) | Both images build |
| [005-compose-up.log](005-compose-up.log) | Pass: all three services healthy |
| [006-scylla-test.log](006-scylla-test.log) | All 215 pass |
| [007-restart.log](007-restart.log) | Manual restart check passes with fixture responses |

The restart check uses `PASTE_FETCH_MODE=fixtures`, the running HTTP API, and
real Scylla. The script uploads the exam sample, parses it, imports both teams,
and saves a GET baseline. After the user confirms a manual restart, another GET
returns the same complete match, including imported teams and timestamps.

The capture includes healthy Compose startup, the baseline, and the script's
PASS result. It does not include the manual restart command. Demo records remain
in season `1349890724` for inspection. This verifies fixture-backed persistence;
successful live imports remain unverified.
