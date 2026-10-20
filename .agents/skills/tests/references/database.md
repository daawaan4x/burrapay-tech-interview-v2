# ScyllaDB testing guide

Use [principles.md](principles.md) for case design and [SKILL.md](../SKILL.md) for
repository scope and authorship rules.

## Choose the evidence

Use `makeRepository(client)` with controlled `client.execute` responses for
driver parameters, paging, row decoding, and `DatabaseError` translation. Keep
repository logic real and check its result as well as relevant driver calls.

A stubbed `wasApplied()` result checks how the repository handles that result.
Use real Scylla for query execution, stored values, and conditional-write behavior.
When claiming concurrency coverage, exercise overlapping operations and inspect
the confirmed outcome without assuming which request wins. Concurrent repository
writes alone do not establish concurrent HTTP behavior.

Use separate driver readback when the claim depends on stored values or their
representation. Table and column checks belong at this persistence boundary.
Consult [repository.ts](../../../../app/backend/src/repository.ts) and the
[storage ADR](../../../../docs/adr/001-store-matches-by-season.md) for storage
shapes; keep storage decoding separate from text parsing.

Structured fixtures are valid setup for storage tests, but bypass parsing and
fetching. A single conditional write is not a general transaction across several
operations, and test cleanup does not establish application atomicity.

## Integration setup

Check [Scylla helpers](../../../../app/backend/test/scylla/helpers.ts) and
[compose.yaml](../../../../compose.yaml) before changing setup. Use the
[README integration commands](../../../../README.md#commands).

- `SCYLLA_TEST_CONTACT_POINTS` enables the integration tests; without it, they
  are skipped. Contact points are comma-separated.
- `SCYLLA_LOCAL_DATACENTER` defaults to `datacenter1`. Turbo passes both variables
  through to the backend.
- `openRepository` creates the fixed `tournament` keyspace and tables if needed.
  These tests write data. Random season numbers reduce collisions but do not
  provide a separate database.
- Compose keeps data in `scylla-data`, which may contain development records.
  The harness provides neither a database per worker nor transaction rollback.

Verify the target and use a disposable local instance. Once integration is
enabled, setup errors remain failures; do not hide them with a skip or fake.

## Isolation and cleanup

- Give each case its own season and UUIDs. Keep cases independent of existing
  rows, run order, and shared mutable state, including across concurrent files.
- Register cleanup as resources are acquired. Track what the test created;
  a failed conditional write does not establish ownership of an existing row.
- Delete only owned rows or partitions, including records written before a later
  failure. Avoid table truncation, keyspace deletion, or volume resets.
- Close Fastify and database clients on success and failure. Use existing hooks
  or `Effect.acquireRelease` with `Effect.scoped`; report cleanup failures.

Separate storage readback from restart durability. Claim survival across a
service restart only after observing it against the local stack with data
preserved.
