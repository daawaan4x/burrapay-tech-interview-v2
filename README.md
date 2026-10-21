# Technical Exam

A minimal Turborepo monorepo using Node.js 24, PNPM, TypeScript, and Biome.

See [EXAM.md](./EXAM.md) for the Backend Developer and Senior Full-Stack Developer
tracks, required tasks, optional work, and submission guidelines.

## Apps

- `app/frontend`: Next.js App Router, running at http://localhost:3000.
- `app/backend`: Fastify, running at http://127.0.0.1:3001.
  `GET /` returns `{ "message": "Hello from Fastify" }`.

The backend uses Effect 3.21.0 (`Effect.Do`, `pipe`, and combinators), without
generators or `yield`. Source imports use `.ts` extensions; TypeScript rewrites
them to runtime extensions during compilation.

## Exam conventions

The scaffold uses the following conventions:

- Import Effect modules by namespace from submodule paths, for example
  `import * as Effect from "effect/Effect"` and
  `import { pipe } from "effect/Function"`, not from the `"effect"` barrel.
- Compose small, named steps with `pipe`, `Effect.Do`, and combinators.
  Do not use generators, `yield`, imperative loops, or `try/catch` in backend
  application logic. Wrap external operations in Effects.
- Keep failures typed and tagged. Handle expected errors explicitly with
  `Effect.catchTags` at the HTTP boundary, and log infrastructure failures.
- Keep validation/types in `src/domain.ts`, domain route plugins in
  `src/routes/`, shared HTTP helpers in `src/http.ts`, Scylla access behind
  `src/repository.ts` and its `src/repository/` modules, and startup/resource
  cleanup in `src/index.ts`.
  `src/app.ts` registers the plugins with their injected repository.
  Fastify's async plugin callbacks only register routes; application workflows
  remain Effect pipelines. Inject persistence so endpoint tests do not require
  Scylla.
- Keep types close to their use. Introduce shared packages or additional
  application layers only when the exercise actually needs them.
- Test success paths and important failure/edge cases. Run tests from the root
  with `pnpm test`; opt into real Scylla tests using the environment variable
  below.

Fastify, Effect Schema, Biome, and Node's test runner are intentional lightweight
choices for this exam. Additional infrastructure and tooling are not
prerequisites.

## Local Docker deployment

Requires Docker with Compose and enough memory for ScyllaDB (at least 1 GB for
Scylla, plus memory for both apps and image builds). On WSL, start Docker Desktop
and enable integration for your distribution.

Run from the workspace root:

```sh
docker compose build                         # Build both production app images
docker compose up -d --wait                   # Start and wait for healthy services
docker compose logs -f backend               # Inspect backend logs
```

The frontend is at http://localhost:3000 and the backend is at
http://localhost:3001. Scylla's CQL port is at `127.0.0.1:9042`.
All published ports are restricted to the local machine. The services share the
`tournament` network; the backend connects to `scylla`, and the frontend receives
`API_BASE_URL=http://backend:3001` for future server-side API calls. The frontend
UI is unchanged; browser-side requests would use the published backend address,
not the internal Docker hostname.

Scylla data persists in the `scylla-data` named volume. The backend waits for
Scylla's health check, then idempotently creates the `tournament` keyspace and
tables before accepting requests. `GET /health` checks database connectivity.
The keyspace uses replication factor 1 for this local single-node setup, not
production deployment.

```sh
docker compose down                          # Stop services; preserve database
docker compose up -d --wait                   # Restart with existing data
docker compose exec scylla cqlsh              # Inspect stored data with CQL
```

`docker compose down -v` also deletes the database volume and all saved data.

## Setup

```sh
nvm install
nvm use
corepack enable
pnpm install
docker compose up -d --wait scylla
pnpm dev
```

If Corepack is unavailable, install the pinned PNPM version with
`npm install --global pnpm@12.4.2`.

## Commands

```sh
pnpm dev        # Run both apps with watch mode
pnpm build      # Build both apps
pnpm start      # Build and run both apps in production mode
pnpm lint       # Check lint rules, formatting, and imports with Biome
pnpm format     # Format with Biome
pnpm typecheck  # Type-check both apps
pnpm test       # Run workspace tests through Turbo
pnpm --filter @repo/backend test # Run API/repository tests
```

Run an individual app with `pnpm --filter @repo/frontend dev` or
`pnpm --filter @repo/backend dev`.

The backend defaults to `HOST=127.0.0.1`, `PORT=3001`,
`SCYLLA_CONTACT_POINTS=127.0.0.1`, and `SCYLLA_LOCAL_DATACENTER=datacenter1`.
Contact points may be comma-separated. Both development and production backend
startup require a reachable database. If using `pnpm dev`, start only the Scylla
Compose service to avoid conflicts with containerized app ports.

To run the real database integration test in addition to the isolated tests:

```sh
docker compose up -d --wait scylla
SCYLLA_TEST_CONTACT_POINTS=127.0.0.1 pnpm test
```

The Scylla tests cover the upload/parse/import workflow, repeated and concurrent
requests, season scoping, and saved-data readback. Paste responses are mocked;
tests do not use the live site. Each case cleans up only its own records and
closes its resources. Database cases are skipped when
`SCYLLA_TEST_CONTACT_POINTS` is unset; the isolated cleanup check still runs.

Captured verification commands and results are in [logs/README.md](./logs/README.md).

## API

Use `Content-Type: application/json` when sending JSON. The body limit is 1 MiB.
Errors use `{ "error": "..." }`. See [EXAM.md](./EXAM.md#shared-api-rules) for
validation rules and status codes.

### Create a season

```sh
curl -i http://localhost:3001/seasons \
  -H 'Content-Type: application/json' \
  -d '{
    "seasonNumber": 1,
    "name": "Season 1",
    "teams": {
      "TMA": "Team A",
      "TMB": "Team B"
    }
  }'
```

Returns `201` with the saved season, or `409` if that season already exists.

### List seasons

```sh
curl http://localhost:3001/seasons
```

Returns `200` with seasons ordered by season number, or `[]` if none exist.

### Upload match text

```sh
curl -i http://localhost:3001/seasons/1/matches/upload \
  -H 'Content-Type: application/json' \
  -d '{
    "text": "TMA vs TMB\nPlayer A vs Player B\nScore: 2-0\n\nPlayer A: [https://www.vrpastes.com/tgiS1Swl](https://www.vrpastes.com/tgiS1Swl)\nPlayer B: [https://www.vrpastes.com/VvVArqgO](https://www.vrpastes.com/VvVArqgO)"
  }'
```

Returns `201` after persistence succeeds:

```json
{
  "uploadId": "05b69234-60e2-42e5-91aa-096bcae239d0",
  "seasonNumber": 1,
  "createdAt": "2026-10-14T00:00:00.000Z"
}
```

The original text is stored unchanged. Use the returned `uploadId` in the
requests below instead of the example UUID.

### Parse a saved upload

```sh
curl -i -X POST \
  http://localhost:3001/seasons/1/matches/uploads/05b69234-60e2-42e5-91aa-096bcae239d0/parse
```

Takes no body. Returns `201` with the parsed match, or `200` with the existing
match on repeat requests. The match ID equals the upload ID. Repeated requests
preserve timestamps and imported teams.

Invalid text returns `422` without saving a match. Parsing leaves the upload
unchanged and does not fetch paste URLs. See the
[match format and response](./EXAM.md#required-task-1-parse-a-saved-upload-and-retrieve-the-match).

### Retrieve a saved match

```sh
curl -i \
  http://localhost:3001/seasons/1/matches/05b69234-60e2-42e5-91aa-096bcae239d0
```

Returns `200` with the saved [match](./EXAM.md#match-response), or `404` if it
does not exist in that season.

### Import team pastes

```sh
curl -i -X POST \
  http://localhost:3001/seasons/1/matches/05b69234-60e2-42e5-91aa-096bcae239d0/teams/import
```

Takes no body. Returns `200` with the saved match and populated `importedTeams`
after both pastes are fetched, extracted, parsed, and saved. Preserves participant
order, source URLs, and extracted text. A failed import leaves the match unchanged.
Repeated imports return the saved result without fetching or changing `importedAt`.
Concurrent successful imports return the same saved import.

Fetches recheck the allowed URLs and reject redirects. Each request imports two
pastes concurrently, with a 10-second deadline per paste through body completion
and a 1 MiB response limit. Upstream failures return `502`, timeouts `504`, and
unusable HTML or invalid team text `422`.

Tests use complete browser snapshots. Fresh responses lacked team data during
the [fixture investigation](./app/backend/test/fixtures/README.md), so successful
live imports remain unverified. Live requests never fall back to fixtures.
See [the extraction ADR](./docs/adr/003-separate-fetching-from-html-extraction.md)
for adapter responsibilities.

# Submission

> authored by Theone Eclarin, writing is mine

## Completion and limitations

- Required Tasks 1 and 2: Completed and checked against Exam guidelines.
- Scope: Backend Developer Track, skipped optional Task 3
- Known Limitations: Could not resolve live paste HTML extraction

Currently, live paste HTML extraction will fail while the automated tests using the offline representative complete HTML snapshots work.

Earlier, when I investigated the live website for HTML extraction, I noticed that the data was from a background request from a seperate backend service in another hostname. The Exam guidelines specifically restrict fetch requests to www.vrpastes.com only. I was not able to find an alternative way on how I can extract relevant information from the live website.

The Exam guidelines explicitly state that offline representative HTML fixtures will be used for the automated coding tests. I downloaded a complete HTML snapshot of the paste-URLs from the provided example of the exam, and also kept the live raw HTML snapshot to showcase the contrast between the two.

See [./app/backend/test/fixtures/README.md](./app/backend/test/fixtures/README.md) for more info on the fixtures

## Learning Effect

Working with Effect.ts for me has been the largest issue constraining how I understand and write code (especially for the reserved work). While I have heard/used of borrowed concepts, the complete paradigm shift to Functional Programming (FP) required a different way of thinking/problem solving. I frequently caught myself thinking in imperative terms and struggling to translate it into FP-form.

The Official Effect.ts Docs have been my primary resource for navigating this gap in my understanding and it has been sufficient enough. It was only the sufficient learning resource/course I was able to searched as well.

I used AI-assistance for clarifications/help and for pointing me which parts of the official docs should I prioritize reading according to the specific Effect.ts coding preferences of the repository (using pipe and combinators).

Before I started my work on the codebase, I spent some time learning and applying Effect.ts standalone to have a grasp of the fundamentals. I still struggled later on how these translated and are used in an actual codebase.

## Troubleshooting

I think the major issue I encountered that took some substantial time for me to settle was the HTML extraction of the live website together with the fetching restrictions to the original hostname only.

To reiterate from above, I was not able to find an alternative way on how I can extract relevant information from the live website. I noticed that the pokemon data was from an API request to a seperate hostname. I assumed there might be other ways and spent a substantial time researching about the site and inspecting around. I am familiar with Pokemon but I don't have in-depth knowledge of the gaming community.

It took a while before I wrote it off as a limitation. The Exam guidelines already state that an offline representative HTML fixture will be used anyway for automated testing, but the paste HTML extractor was still written to anticipate that the relevant info might be missing in the paste HTML.

## Verification

The following commands were executed as part of the automated verifications required by the [EXAM.md](./EXAM.md). All commands ran successfully and the results were saved into seperate log files for each step in the [./logs](./logs/) folder, view the folder's [README.md](./logs/README.md) for more information.

To summarize the results:

| Required command | Result |
|---|---|
| `pnpm lint` | ✅ 53 files checked  |
| `pnpm typecheck` | ✅ passed |
| `pnpm test` | ✅ 207 backend tests |
| `docker compose build` | ✅ passed |
| `docker compose up -d --wait` | ✅ Podman; all three services healthy |
| `SCYLLA_TEST_CONTACT_POINTS=127.0.0.1 pnpm test` | ✅ 215 backend tests |

The persistence was verified to survive restarts. You can run the following command to start the dev with the offline HTML fixtures:

```sh
PASTE_FETCH_MODE=fixtures podman compose up -d --wait
```

Then proceed to test the instance with the script below. This will run requests to import the sample match text, wait for you to restart the service, and checks that the records survived.

```sh
pnpm --filter @repo/backend exec tsx src/scripts/check-restart.ts
```

Captured output: [007-restart.log](./logs/007-restart.log).

## Resources and AI assistance

- **External Resources:** Prior similar experience/familiarity with Typescript, Fastify, and SQL (ScyllaDB's CQL was somewhat similar enough) helped in navigating the codebase. Working with Effect.ts required the biggest adjustment. 

  Primary learning resource:
  - [Official Effect.ts Docs](https://effect.website/docs/v3/)

  Other supporting sites include:
  - [Fastify](https://fastify.dev/docs/)
  - [ScyllaDB](https://docs.scylladb.com/stable/)
  - [Cheerio](https://cheerio.js.org/) for HTML extraction

- **Reserved work:** After multiple iterations, I used a top-down approach for both parsers using Effect functions composed together and regex for granular per-line capturing of information. I implemented all critical tests as well, and ensured the parsers considered those edge-cases.

  For the parsers, I initially went with a pure regex approach as a starter presuming it would result to a clean approach, but I spent a substantial amount of time attempting to finalize edge cases and it also made it impossible returning meaningful error messages for different cases.

  I restarted from scratch and pre-processed text to divide-and-conquer into parts first in code, before feeding per line to regex. This technically resulted to longer code, but the problem/solution was decomposable and it was easier to walkthrough.

  For handling the partial persistence, paste-URL parsing ran concurrently for both player links, and the routes evaluated if both were successful first before proceeding to persisting the results. This ensured no team gets imported if one of the links were not parsed successfully.

- **AI-assisted work:** Using GPT-6.1 Sol High, I leveraged AI-assistance where possible for any scaffolding and non-reserved supporting work. I still took ownership of making engineering decisions and high-level planning for all the tasks involved.

  I planned with specification docs first using AI to map out the changes and steps to be done, asked clarifications on the product/high-level flow of the behaviors/cases to implement/consider, and ran self-reviews to ensure the exam and repo docs are being followed.

  Once implemented, I ran self-reviews again, followed up with refactor/tidy up requests for keeping code simple & organized, kept related docs updated, and repeated the whole process. Identifying code smell was mostly judgement (from signals like nesting/branching, LoC, verbosity, etc.), having it cleaned up helped in making it easier for me to understand and reason with.

  I included and created additional skills for the AI agent, particularly for [grilling ideas/decisions/plans](.agents/skills/grilling) and principles for [listing/writing *good* test cases](.agents/skills/tests). See the skills for more info.

  In reserved work, AI-assistance was used for understanding the requirements and how the tasks connects to the surrounding scaffold/support.