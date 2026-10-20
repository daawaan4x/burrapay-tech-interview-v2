# Test design and runner guide

Apply the repository scope and authorship rules linked from [SKILL.md](../SKILL.md).

## Test observable behavior

Exercise the public interface that owns the behavior. Assert what a caller can
observe: a result, public error, HTTP response, stored state, or external request.
Keep the behavior and its validation real; fake external effects where needed.

| Behavior | Where to test |
| --- | --- |
| Pure function or schema | Call the exported API directly |
| HTTP validation, response shape, or error translation | Fastify `app.inject` with an injected repository |
| Work across local modules | Real local code with fakes at database or HTTP boundaries |
| HTTP transport or HTML extraction | Real adapter with controlled response fixtures |
| Driver parameters, paging, or decoding | Real repository with a controlled driver |
| Query execution, stored values, or conditional writes | Real repository against ScyllaDB |

A fake repository does not establish persistence. A driver stub does not
establish query validity or server concurrency behavior. Use the
[database guide](database.md) when those properties matter.

## Design cases

Cover representative success and distinct failure or boundary behavior required
by the contract. For permitted bug fixes, prefer a regression case that exposes
the failure. Add variations only when they provide different evidence.

Name cases by condition and observable result, using public terms. Names should
make sense alone in runner output. Avoid vague names or names that only describe
helper calls. Give table rows meaningful names.

Arrange, act, then assert. Keep nesting shallow. Use tables for variations of the
same behavior. Split independent behaviors, but keep assertions together when
they describe one result, such as a status and response body.

## Keep tests simple

- Prefer straightforward tests and a few meaningful groups. Avoid suites that
  only wrap another suite or repeat distinctions the public interface no longer has.
- Use compact case tables when setup and assertions are shared. Keep distinct
  behavior explicit; avoid boolean mode switches or a custom test framework.
- Extract helpers only when they make repeated code easier to read. Keep helpers
  local unless several files need them; avoid one-use wrappers and fixture builders
  that hide the input or calculate expected behavior.
- Remove redundant setup, stale comments, unused imports, duplicate placeholders,
  and routine diagnostic dumps from permitted code. Comments should explain why.
- During cleanup, preserve meaningful cases, independent expectations, typed-error
  checks, isolation, and returned or awaited asynchronous work. Do not edit
  candidate-owned tests or logic as part of tidying.
- Optimize for clarity, not a line-count target. Avoid dense expressions that make
  a short test harder to understand.

## Avoid misleading tests

For every case, ask what plausible defect in real application code would make
it fail. A test is tautological when its result follows from the setup without
depending on the application behavior it claims to check. This applies to all
tests, including pure functions, HTTP, extraction, storage, and test helpers.

Mocks are useful when real code's handling of a controlled dependency result is
the behavior under test. Merely configuring a fake and confirming that fake's
behavior adds no evidence. Keep the behavior being assessed real, and derive
expectations independently of both the implementation and the fake's logic.

Choose the remedy from the evidence:

- Rename a case when it already catches a meaningful application defect but its
  name overstates its scope. Confirm any broader required behavior has coverage.
- Revise or supplement a case when the claimed behavior is required but its
  setup or assertions cannot detect a violation. Renaming does not close that gap.
- Remove a case that only verifies its own setup or duplicates existing evidence
  without protecting a distinct behavior. Preserve required coverage.

Apply these remedies only to permitted work. Report problems in candidate-owned
tests without supplying their design or fixes. Empty placeholders are unfinished
work, not passing behavioral evidence.

| Weak check | Better evidence |
| --- | --- |
| Assert a fake returns its configured value | Exercise the real code that consumes it and assert the public result |
| Count private helper calls | Check the result or state those calls should produce |
| Copy production logic to calculate expectations | Use expectations justified independently by the contract |
| Accept any rejected promise | Check the intended failure and meaningful fields |
| Snapshot a large response to protect one field | Assert the relevant field and relationships |

Assert collaborator calls when the call itself is the contract, such as an HTTP
request or prepared driver parameters. Avoid incidental call order, query
whitespace, and private helper counts that break under harmless refactoring.

## Assertions and fixtures

- Assert enough of the public contract to detect a regression. With
  `node:assert/strict`, use `assert.equal` for primitives or intentional identity,
  `assert.deepEqual` for complete structures, and field assertions for subsets.
- Derive expectations independently. Observed output needs justification before
  becoming an expected value; changing assertions merely to pass hides failures.
- Keep fixtures valid, minimal, and deterministic unless invalid data is the
  subject. Use fixed IDs and dates in isolated cases; check formats and
  relationships when production generates them.
- Create fresh mutable state per case. Shallow copies still share nested arrays
  and objects. Avoid hidden state or domain behavior in fixture builders.
- Keep input and output validation active with fakes. Make unexpected side
  effects fail visibly instead of accepting them through permissive defaults.
- Restore spies, environment changes, clocks, timers, and globals after use.
  Prefer injected dependencies over shared process state.
- Use snapshots only when the whole output deserves protection. Comments should
  explain non-obvious rationale or regression history, not narrate the code.

HTTP extraction fixtures need representative markup and encoding; normalized
text alone cannot establish HTML extraction behavior. Describe fixture origins
accurately. Apply EXAM.md's offline-fixture requirements and authorship rules
when choosing or changing fixture data.

## Node, Fastify, and Effect

The backend runs `tsx --test "test/**/*.test.ts"` with `node:test` and
`node:assert/strict`. Group related tests in `test/matches/`, `test/scylla/`, and
`test/team/`; keep other tests at `test/`. Helpers use a different suffix.
`tsconfig.test.json` checks both source and tests recursively.

Use `buildApp` with an injected `Repository` and `app.inject` for HTTP tests.
Register `app.close()` with `t.after` or a scoped release. Use test-scoped
`t.mock.method` for driver stubs. Import app construction from `src/app.ts`;
`src/index.ts` opens real startup resources.

Return or await `Effect.runPromise` at the test boundary so the runner observes
completion and assertion failures. `Effect.flip` or `Effect.either` can expose
expected typed failures; assert meaningful tags and fields instead of wrapped
error strings. Use real tagged error types in dependency fakes.

Use controlled responses or timing instead of arbitrary sleeps. Bound incidental
retries and register cleanup when resources are acquired so failures do not leak
resources or state.

Run focused checks while investigating, then the broader README checks suited to
the change. Report actual results and skips. Distinguish isolated tests, real
database checks, live observations, and restart checks. Seeded records do not
establish that parsing or import works.
