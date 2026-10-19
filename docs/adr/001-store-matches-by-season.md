---
status: accepted
date: 2026-10-19
---

# Store matches by season

Store each match in one ScyllaDB row, using the season number and upload UUID
to identify it. The upload UUID is also the match ID. Keeping the match in one
row supports later Pokemon team imports and the requirement in
[EXAM.md](../../EXAM.md#required-task-1-parse-a-saved-upload-and-retrieve-the-match)
that every match lookup stays within the requested season.

Use separate scalar columns, each holding one value, for IDs, the season number,
the parsing timestamp, and the winning team code. Store the participants as JSON
text in another column, keeping their order. Use a separate JSON text column for
imported-team data, which is null until task 2 succeeds. Both nested parts of the
response stay in the same match row.

## Consequences

The application must decode the stored JSON into typed data and report decoding
failures as operational errors. Changes to the JSON structure must account for
records already saved.

Storage keeps the participant order and values supplied by the candidate's
implementation unchanged. Its decoding work is limited to the stored data's
shape. Match-text parsing and validation, including scores, URLs, participant
pairing, and winner derivation, must be designed, written, and debugged by the
candidate under [AGENTS.md](../../AGENTS.md#candidate-owned-work). AI-assisted
storage helpers must not take over that work.

Supporting storage is implemented and covered by isolated tests and a real
Scylla integration check. Candidate-owned parsing remains incomplete.
