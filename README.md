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
See [the adapter notes](./docs/task-2-support.md) for extraction details.

# Submission

<TODO>