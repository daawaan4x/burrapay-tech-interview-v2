---
status: accepted
date: 2026-10-21
---

# Save complete team imports with a conditional update

Save both imported teams together in the existing match row after both paste
operations succeed. Extend the storage layout in
[ADR 001](001-store-matches-by-season.md) with a conditional update of the
`imported_teams` JSON column. Keeping the complete import in one update avoids
coordinating separate team writes to meet the exam's
[persistence rules](../../EXAM.md#persistence-and-repeated-requests).

The update requires no saved import and a non-null upload ID on the match, so it
preserves an already saved import and cannot create a missing match. The
repository reads back the saved match after the update. Overlapping successful
requests therefore return the stored winner, including its timestamp, while
the original match fields remain unchanged.

## Consequences

An already imported match returns its saved data before fetching or taking a
new timestamp. Requests that overlap before either saves may still fetch the
pastes independently; the conditional database update protects the stored
result without an application request lock.

The response depends on successful database readback. A missing match or failed
readback returns an error rather than the locally assembled import. This uses
the existing table and repository lifecycle, without separate team records or
a transaction across multiple writes.
