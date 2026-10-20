---
status: accepted
date: 2026-10-21
---

# Use ordinary HTTP and representative HTML fixtures

Use ordinary HTTP requests for live imports and representative HTML fixtures for
offline tests. The [fixture investigation](../../app/backend/test/fixtures/README.md)
records that fresh requests returned a page shell, while the loaded browser DOM
contained team cards. The page obtains its data from another hostname, outside
the exam's allowed fetch destination. Headless rendering was left out under
that restriction.

Supply the complete browser snapshots at the injected fetch boundary for
successful extraction and import tests. Keep the raw response fixture to check
failure when team markup is absent. This follows the exam's allowance for
[representative fixtures](../../EXAM.md#fetching-and-extraction) when the example
pastes are unavailable, with the observed limitation documented.

## Consequences

Successful fixture tests assume that complete HTML reaches the adapter. They do
not establish successful live extraction. The snapshots represent the loaded
DOM, not the body returned by the recorded fresh requests.

Live imports use the content actually fetched and return the applicable error
when extraction or validation fails. Fixtures never replace a failed live
response. The fixture record keeps the source observations and provenance;
this decision records how those files are used.
