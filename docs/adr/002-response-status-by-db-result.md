---
status: accepted
date: 2026-10-19
---

# Choose the parse response status from the database result

Use a conditional ScyllaDB insert to create a match only if it does not already
exist, preventing duplicate records when requests overlap. In either case, the
repository returns the saved match and whether this request created it. The
parse endpoint uses that confirmed database result to return `201` for a new
match or `200` for an existing one.

Requests that do not create a row return the existing match with its timestamp
and imported teams unchanged. Send a successful creation response only after
the required database write succeeds; a write failure returns an error. This
follows the rules for repeated requests in
[EXAM.md](../../EXAM.md#required-task-1-parse-a-saved-upload-and-retrieve-the-match).

The shared response helper in [http.ts](../../app/backend/src/http.ts) sends the
selected status and match, and handles tagged errors with `Effect.catchTags`.

## Consequences

Whether the match was created stays internal to the application. It determines
the HTTP status without adding fields to the exam's match response.

This decision covers database access and HTTP handling. The candidate must
personally design, write, and debug the parser and the tests designated as manual
under [AGENTS.md](../../AGENTS.md#candidate-owned-work). The manual tests' inputs,
expected values, and assertions must also be candidate-authored, including when
used through supporting fixtures or helpers.

Supporting database and HTTP handling are implemented and tested. Existing saved matches can be retrieved and returned by repeated parse requests with `200`.
