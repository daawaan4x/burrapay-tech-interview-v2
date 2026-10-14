# Technical Exam

## Goal and timebox

You have 3-4 days to extend this scaffold for your assigned role. The exercise evaluates your ability to
follow a specification, learn Effect, and investigate problems methodically.

| Role | Required work | Optional work |
|---|---|---|
| Backend Developer | Backend tasks 1 and 2 | Task 3: standings endpoint |
| Senior Full-Stack Developer | Backend tasks 1 and 2, plus the frontend workflow below | Task 3: standings endpoint and a simple standings view |

Complete your role's required work before attempting optional work. A complete,
tested implementation of the required work can earn full marks without optional
tasks. Prefer a small, reliable solution over additional features. For the
Full-Stack track, keep the UI to one workflow rather than building a dashboard
platform; prioritize a working vertical slice early.

Read [README.md](./README.md) for setup, commands, and the existing API.

## AI assistance and manual work

AI assistance is permitted for learning and supporting work, but not for the
entire solution. [AGENTS.md](./AGENTS.md) explains the boundaries to AI tools;
the same rules apply to candidates using chat tools or inline code completion.

Personally design, write, and debug:

- The match-text parser and its validation, participant pairing, and winner
  derivation.
- The Pokemon team-text parser and its validation. You may use AI assistance
  for HTTP transport and HTML extraction, not for converting team text into
  Pokemon records.
- At least these critical tests: correct pairing when input order is reversed;
  invalid-score rejection; missing-ability rejection; and an import where one
  paste fails, asserting that nothing is persisted.
- For the Senior Full-Stack track: workflow state transitions, duplicate-action
  prevention, and stale-response handling after a season change. Also personally
  write a test covering the stale-response case.
- Your troubleshooting account and submission reflection. Describe actual
  observations, not a generated narrative.

For these pieces, do not use AI-generated code, tailored algorithms/pseudocode,
regexes, fixes, or inline completions, even if you later edit them. General
concept explanations and official documentation are allowed. AI review may
identify a problem but must not provide the implementation or corrective
algorithm. Disable inline AI completion while working on reserved pieces.

AI may assist with route/database scaffolding, HTTP fetching/extraction,
deployment setup, styling/presentational components, API transport, and other
tests. You must understand and verify all assisted work.

In the submission, identify which areas were manually implemented and which
used AI assistance. Be prepared to explain your parsers, tests, and diagnosis,
and make a small change during a follow-up discussion. These are assessment
rules, not a claim that an instructions file can prevent AI use.

## Starting point

The scaffold already provides:

- `POST /seasons`: create a season with a team-code-to-name map.
- `GET /seasons`: list seasons.
- `POST /seasons/{seasonNumber}/matches/upload`: save `{ "text": "..." }`
  unchanged and return an upload ID.
- ScyllaDB persistence and a Docker Compose setup for both apps and the database.
- Effect pipelines, input validation, typed errors, and isolated/integration tests.

Do not change the contracts or behavior of those endpoints. Frontend work is
required only for the Senior Full-Stack track. Authentication, background jobs,
and deployment beyond local Compose are not required for either role.

## Implementation conventions

- Use TypeScript with strict typing and `.ts` extensions for local imports.
- Import Effect modules from submodule paths:

  ```ts
  import * as Effect from "effect/Effect";
  import { pipe } from "effect/Function";
  import * as Schema from "effect/Schema";
  ```

- Compose small, named functions using `pipe`, `Effect.Do`, `Effect.bind`,
  `Effect.map`, `Effect.flatMap`, and related combinators.
- Do not use generators, `yield`, imperative loops, or `try/catch` in new backend
  application logic. Do not substitute an `async`/`await` workflow for an Effect
  pipeline. Promise-based APIs may be used at boundaries and wrapped in Effects.
- Keep parsing and transformations separate from HTTP and database operations.
- Use typed, tagged failures and handle expected errors explicitly with
  `Effect.catchTags` at the HTTP boundary. Log operational failures without
  exposing internal details to clients. Do not turn failures into empty or
  success-shaped responses.
- Inject external dependencies so tests can control database and HTTP behavior.
  Extend the existing repository pattern; a new dependency-injection framework
  or shared package is not necessary.
- Preserve raw inputs, avoid unnecessary casts, and use the existing formatter.
- Persist new records in ScyllaDB. In-memory storage is acceptable only in tests.
- For the Full-Stack track, use the existing Next.js App Router frontend.
  Effect conventions apply to new server-side code, including any BFF handlers.
  Ordinary React hooks and event handlers are allowed in client components;
  browser UI code does not have to use Effect.

## Shared API rules

- Season numbers must be positive safe integers. Upload and match IDs must be
  valid UUIDs.
- Every lookup must be scoped to the season in the URL. An ID belonging to
  another season must not return that record.
- The two new POST endpoints take no request body. Reject a supplied JSON body
  with `400`.
- Use UTC ISO 8601 timestamps in responses.
- Return errors as `{ "error": "<meaningful message>" }`. Exact message wording
  is your choice, but status codes and success response shapes below are required.

| Status | Meaning |
|---|---|
| `400` | Invalid path parameters or unexpected request body |
| `404` | Season, upload, or match does not exist in the requested scope |
| `422` | Saved match text or fetched team content cannot be parsed or validated |
| `502` | Paste request fails, returns a non-success status, or violates fetch limits |
| `504` | Paste request times out |
| `503` | Database operation fails |

Do not return success until the required database write has succeeded.

## Required task 1: Parse a saved upload and retrieve the match

### Endpoints

```text
POST /seasons/{seasonNumber}/matches/uploads/{uploadId}/parse
GET  /seasons/{seasonNumber}/matches/{matchId}
```

The POST endpoint reads the saved upload, parses and validates it, and saves a
structured match. It must not fetch the paste URLs or modify the original upload.

Use the upload's UUID as the match ID. Parsing an upload for the first time
returns `201`. Parsing it again returns `200` with the existing match, without
creating another record, changing timestamps, or clearing imported teams.
Protect against duplicate records when requests overlap.

The GET endpoint returns `200` with the saved match.

### Input format

Create a season containing `TMA` (Team A) and `TMB` (Team B), then upload this
text using the existing upload endpoint:

```text
TMA vs TMB
Player A vs Player B
Score: 2-0

Player A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)
Player B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)
```

Parsing rules:

1. Accept LF and CRLF line endings, blank lines, and leading/trailing whitespace
   on each line. Parsing normalization must not alter the stored original text.
2. After removing blank lines, require exactly five lines in the order shown.
   `vs` and `Score:` are case-sensitive. Accept one or more spaces around `vs`,
   around the score hyphen, and after each colon.
3. Team codes and player names correspond by position: the first player belongs
   to the first team, and the second player belongs to the second team. In the
   example, Player A belongs to TMA and Player B belongs to TMB. These are not
   home/away designations. Preserve this order in a two-entry `participants` array.
   Both team codes must exist in the season and must differ. Code matching is
   case-sensitive. Player names must be nonempty and distinct after trimming.
   Internal spaces in names are allowed.
4. The score is best-of-three and follows participant order: the first score
   belongs to the first team/player, and the second to the second team/player.
   Accept only `2-0`, `2-1`,
   `0-2`, or `1-2`, allowing the whitespace described above. Do not accept ties,
   negative numbers, extra digits, or unfinished scores.
5. Each URL line must name its corresponding player, in participant order.
   Accept a plain URL or a Markdown link. For Markdown, the label must equal
   the target URL. Reject missing, duplicate, or mismatched player URL lines.
6. Accept only HTTPS URLs on the exact hostname `www.vrpastes.com`, with no
   credentials, explicit port, query, or fragment, and a single nonempty
   alphanumeric paste-ID path segment. Reject all other destinations.
7. Derive the winner from the score, not from player names or URL contents.

Malformed or semantically invalid saved text returns `422` and creates no match.

### Match response

Return this shape from both endpoints. IDs and timestamps below are illustrative:

```json
{
  "matchId": "05b69234-60e2-42e5-91aa-096bcae239d0",
  "uploadId": "05b69234-60e2-42e5-91aa-096bcae239d0",
  "seasonNumber": 1,
  "participants": [
    {
      "teamCode": "TMA",
      "playerName": "Player A",
      "score": 2,
      "pasteUrl": "https://www.vrpastes.com/tgiS1Swl"
    },
    {
      "teamCode": "TMB",
      "playerName": "Player B",
      "score": 0,
      "pasteUrl": "https://www.vrpastes.com/VvVArqgO"
    }
  ],
  "winnerTeamCode": "TMA",
  "parsedAt": "2026-10-14T00:00:00.000Z",
  "importedTeams": null
}
```

`importedTeams` is `null` until required task 2 succeeds.

## Required task 2: Import the two Pokemon team pastes

### Endpoint

```text
POST /seasons/{seasonNumber}/matches/{matchId}/teams/import
```

Load the parsed match, fetch its two saved paste URLs, extract the team text,
parse both teams, and persist the result. Return `200` with the complete match
response from task 1, replacing `importedTeams` with the object defined below.

### Fetching and extraction

- Investigate how the paste site exposes its team text. Support the sample URLs
  using a small, documented extraction adapter. Do not treat a whole HTML page
  as Pokemon text or hard-code the sample teams.
- A documented raw-text representation on the same allowed hostname is
  acceptable. Preserve the match's original paste URL as `sourceUrl`.
- Enforce the URL restrictions from task 1 again at the fetching boundary.
  Do not automatically follow redirects to arbitrary destinations. Either
  reject redirects or validate each destination with the same restrictions.
- Apply a 10-second timeout per paste, covering the response body as well as the
  initial response. Limit each fetched body to 1 MiB.
- Translate network failures, non-2xx responses, unsafe redirects, and oversized
  responses to `502`; timeouts to `504`; invalid team content to `422`.
- Fetching sequentially or with bounded concurrency is acceptable. Automatic
  retries are not required.

Do not rely on live internet access for automated tests. Commit representative
HTTP response fixtures and inject/mock the fetch dependency. Include a fixture
for the site's actual response format, not just the normalized text below.
If the example pastes are unavailable, document the observed failure and use
representative fixtures; do not silently fake a successful live import.

### Minimum supported team-text format

Support standard text exports consisting of 1-6 Pokemon blocks separated by
blank lines. Accept LF/CRLF and trim surrounding whitespace on each line.
This original sample illustrates the required subset:

```text
Sparky (Pikachu) @ Light Ball
Ability: Static
Level: 50
EVs: 252 SpA / 4 SpD / 252 Spe
Timid Nature
IVs: 0 Atk
- Thunderbolt
- Volt Switch
- Grass Knot
- Protect

Charizard @ Heavy-Duty Boots
Ability: Blaze
- Flamethrower
- Air Slash
```

For each block:

- Read species and optional nickname from either `Species` or
  `Nickname (Species)`. Accept an optional trailing `(M)` or `(F)` gender marker.
- Read the optional held item after ` @ `. Represent absent nickname/item as
  `null`.
- Require exactly one nonempty `Ability:` line and 1-4 nonempty `- Move` lines.
  Preserve Pokemon and move order.
- Allow standard metadata lines for `Level:`, `Shiny:`, `Happiness:`, `EVs:`,
  `IVs:`, `Tera Type:`, and a line ending in ` Nature`. These need not be
  structured or validated, but remain in the preserved raw text.
- Reject empty teams, more than six Pokemon, missing required fields, duplicate
  ability lines, and unrecognized lines. No Pokedex lookup, battle legality
  validation, or support for every export variation is required.

### Imported-team response

`importedTeams` has the following structure. Its two-entry `participants` array
must preserve the match's participant order and team/player pairing. Each
participant can have up to six Pokemon; only one is shown per participant here:

```json
{
  "importedAt": "2026-10-14T00:05:00.000Z",
  "participants": [
    {
      "teamCode": "TMA",
      "playerName": "Player A",
      "sourceUrl": "https://www.vrpastes.com/tgiS1Swl",
      "rawText": "Sparky (Pikachu) @ Light Ball\nAbility: Static\n- Thunderbolt",
      "pokemon": [
        {
          "species": "Pikachu",
          "nickname": "Sparky",
          "item": "Light Ball",
          "ability": "Static",
          "moves": ["Thunderbolt"]
        }
      ]
    },
    {
      "teamCode": "TMB",
      "playerName": "Player B",
      "sourceUrl": "https://www.vrpastes.com/VvVArqgO",
      "rawText": "Charizard\nAbility: Blaze\n- Flamethrower",
      "pokemon": [
        {
          "species": "Charizard",
          "nickname": null,
          "item": null,
          "ability": "Blaze",
          "moves": ["Flamethrower"]
        }
      ]
    }
  ]
}
```

Preserve the extracted team text in `rawText`, before parsing normalization.
For an HTML response, this means the extracted, HTML-decoded text, not the page
markup. Document any extraction-specific line-ending behavior.

### Persistence and repeated requests

- Save neither team unless both have been fetched and parsed successfully.
  Prefer a single match-record update rather than coordinating separate writes.
- A failed import must leave the saved match unchanged.
- GET from task 1 must return the imported data after success.
- Repeating an import on an already imported match returns its saved data with
  `200`, without fetching again or changing `importedAt`.
- Concurrent successful imports must not corrupt the match or save half an
  import. Use a conditional write if needed. Forced refresh is out of scope.

## Optional task 3: Season standings

```text
GET /seasons/{seasonNumber}/standings
```

Calculate standings from all parsed matches in the season. Team-paste import
status does not affect standings. Include every season team, even those with
no matches; an existing season with no matches returns zeroed entries.

Return `200` with `{ "seasonNumber": 1, "standings": [...] }`. Each entry contains:

```json
{
  "teamCode": "TMA",
  "teamName": "Team A",
  "played": 1,
  "wins": 1,
  "losses": 0,
  "gamesWon": 2,
  "gamesLost": 0,
  "gameDifferential": 2
}
```

Each match counts once per participating team. Sort by wins descending, then
game differential descending, then team code in ascending case-sensitive
lexicographic order. Read all database pages. Use functional aggregation and
avoid introducing a separately maintained standings table for this exercise.

## Senior Full-Stack Developer: Required frontend workflow

Build a small, usable interface for the full sequence:

```text
Create/select season -> Upload text -> Parse match -> Import teams -> View result
```

Use the real backend endpoints. A single page plus a match-details route is
enough. No separate frontend feature is required for the Backend Developer track.

### 1. Create and select a season

- Load seasons from `GET /seasons` and allow the user to select one.
- Provide a form for season number, name, and one or more team-code/name pairs.
  Support adding/removing team rows, and submit the agreed JSON shape.
- Show useful field validation and API errors, including duplicate seasons.
- After successful creation, refresh the list and select the created season.
- Show explicit loading, empty-list, and failed-load states. Allow retrying a
  failed load; do not display a failed request as an empty list.

### 2. Upload and parse match text

- Provide a labeled multiline text input and submit `{ "text": "..." }` to the
  selected season's upload endpoint. Reject blank input in the UI.
- Keep the user's text after failures. Show the upload ID after success.
- Make parsing a separate, explicit action using the returned upload ID. Do not
  automatically fetch team pastes during upload or parsing.
- Show the parsed participants with each player's team code/name, score, paste
  link, and the winning team. Preserve team/player pairing and input order.
- If parsing fails, display the backend error. The user must be able to edit the
  text and create a new upload; do not require mutation of the saved upload.
- Prevent actions from using a stale upload/match after the selected season
  changes. Ignore stale request results if the user changes context while a
  request is pending.

### 3. Import and view Pokemon teams

- Provide an explicit import action once a match has been parsed.
- Show an in-progress state and meaningful import failures, with a retry action.
  A failed import must not look successful or clear the parsed match.
- On success, render each participant's Pokemon in order, including species,
  optional nickname/item, ability, and moves. Missing optional values should be
  displayed consistently without showing the literal string `null`.
- Make the original paste links and preserved imported text available for
  inspection; raw text can be in a collapsible section.
- Show when teams have already been imported. Avoid accidental duplicate
  submissions while an action is pending.

### 4. Refreshable match details

- Give each parsed match a URL containing its season number and match ID, for
  example `/seasons/1/matches/{matchId}`.
- Opening that URL directly or refreshing it must retrieve the match using the
  required GET endpoint, not depend on the upload screen's in-memory state.
- If teams have not been imported, allow importing them from this view.
- Show distinct loading, missing-match, and operational-error states.
- Persistence remains in ScyllaDB; browser storage must not be the authoritative
  source of match data. A match-list endpoint or upload-history screen is not
  required.

### Integration and usability

- Make API access work with both `pnpm dev` and the containerized Compose stack.
  Respect the difference between a server-side Docker hostname and a URL the
  browser can reach.
- Use a same-origin Next.js BFF or a configurable browser-facing backend URL with
  appropriately scoped CORS. Choose one simple approach and document it.
  A BFF must preserve backend statuses/errors and must not duplicate parsing or
  persistence logic.
- Do not expose server-only configuration in browser bundles or hard-code
  container hostnames into client code.
- Use labeled fields, semantic buttons, keyboard-accessible controls, and
  announced loading/error feedback. Keep the layout usable on narrow screens.
- Basic styling is sufficient. No component library, elaborate visual design,
  authentication, drag-and-drop, or file upload is required.

### Frontend verification

Add focused automated tests for:

- Season creation/selection and the upload -> parse -> import success flow.
- Correct participant/team pairing in rendered results.
- A parse failure and an import failure, retaining useful state and allowing retry.
- Pending-action duplicate prevention and stale state after a season change.
- Direct match-details loading and missing-match behavior.

Use deterministic mocked API responses for these tests, and do not call live
paste URLs. Browser-based or component tests are acceptable; add only the
tooling needed and wire it into `pnpm test`. Document a manual end-to-end check
against the real local Compose stack, including refreshing an imported match.

If completing optional task 3, a simple standings table for the selected season
is sufficient. It is not required for full marks.

## Backend tests and troubleshooting

Add tests covering at least:

- Parsing the sample, plain links, CRLF/whitespace, and a second-participant win.
- Correct team/player/score/paste pairing, including when participant order is
  reversed in the input.
- Invalid scores, unknown/repeated team codes, repeated players, mismatched
  player links, malformed text, and disallowed URLs.
- Invalid IDs, missing records, and an upload/match requested under another
  season.
- Repeated parsing/imports and preservation of the original upload.
- Paste extraction and parsing, optional fields, invalid/empty team content.
- Upstream non-2xx responses, network errors, timeout, redirect policy, and
  oversized bodies.
- One paste succeeding while the other fails, with no partial data persisted.
- Database read/write failures and successful readback of the new records.
- If implementing standings: teams without matches, second-participant wins,
  ties in the ranking criteria, and no double counting after repeated parsing.

Use deterministic fixtures for isolated tests. Add a Scylla integration test
that can be explicitly enabled and cleans up only records it creates.
Demonstrate that new data survives service restart.

Do not hide setup or upstream failures. Investigate them, preserve useful
diagnostic information, and document any unresolved limitation.

## Submission

Submit your implementation together with:

1. Updated API usage examples and any new configuration/setup instructions in
   [README.md](./README.md).
2. Automated tests and committed paste-response fixtures.
3. A brief submission section in the README covering:
   - What is complete and any known limitations.
   - How you learned the Effect APIs you used.
   - One concrete issue encountered, your diagnosis, the fix or workaround, and
     how you verified it.
   - Test/build commands run and their results.
   - Any external resources or AI assistance used, and how you verified the work.
   - For the Full-Stack track: the UI entry points, API connection approach, and
     results of the real end-to-end workflow and refresh checks.

Before submitting, run:

```sh
pnpm lint
pnpm typecheck
pnpm test
docker compose build
docker compose up -d --wait
SCYLLA_TEST_CONTACT_POINTS=127.0.0.1 pnpm test
```

## Evaluation

We evaluate:

- **Instruction compliance:** required contracts, scope, and Effect conventions.
- **Correctness:** validation, persistence, idempotency, and error behavior.
- **Learning and reasoning:** understandable composition and explainable choices.
- **Troubleshooting:** reproducible diagnosis and verification, not just a happy
  path that happens to work.
- **Maintainability and testing:** focused changes, useful tests, and clear setup.
- **Senior Full-Stack track:** end-to-end integration, reliable UI state,
  participant pairing, accessibility, and sensible client/server boundaries.
  Visual polish alone does not compensate for broken behavior.

The optional task is a bonus, not a substitute for incomplete required work.
Do not add unrelated features to compensate for missing requirements.
