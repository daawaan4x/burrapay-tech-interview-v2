import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Client } from "cassandra-driver";
import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { DatabaseError } from "../src/domain.ts";
import { openRepository } from "../src/repository.ts";

const mockClient = (t: TestContext) => ({
  connect: t.mock.method(Client.prototype, "connect", () => Promise.resolve()),
  execute: t.mock.method(Client.prototype, "execute", (_query: string) =>
    Promise.resolve(),
  ),
  shutdown: t.mock.method(Client.prototype, "shutdown", () =>
    Promise.resolve(),
  ),
});

test("constructing the repository effect does not open or use the client", (t) => {
  const { connect, execute, shutdown } = mockClient(t);

  openRepository(["127.0.0.1"], "datacenter1");

  assert.equal(connect.mock.callCount(), 0);
  assert.equal(execute.mock.callCount(), 0);
  assert.equal(shutdown.mock.callCount(), 0);
});

test("schema initialization runs sequentially in dependency order", async (t) => {
  const { connect, execute } = mockClient(t);
  let activeQueries = 0;

  execute.mock.mockImplementation(async () => {
    activeQueries += 1;
    assert.equal(activeQueries, 1, "Initialization queries must not overlap");

    await Promise.resolve();
    activeQueries -= 1;
  });

  await Effect.runPromise(
    pipe(openRepository(["127.0.0.1"], "datacenter1"), Effect.scoped),
  );

  assert.equal(connect.mock.callCount(), 1);
  assert.deepEqual(
    execute.mock.calls.map(
      (call) =>
        /CREATE (?:KEYSPACE|TABLE) IF NOT EXISTS (\S+)/.exec(
          call.arguments[0],
        )?.[1],
    ),
    [
      "tournament",
      "tournament.seasons",
      "tournament.match_uploads",
      "tournament.matches",
    ],
  );
});

test("the client stays usable until the caller scope closes", async (t) => {
  const { execute, shutdown } = mockClient(t);

  await Effect.runPromise(
    pipe(
      openRepository(["127.0.0.1"], "datacenter1"),
      Effect.tap((repository) => {
        assert.equal(shutdown.mock.callCount(), 0);

        return repository.health();
      }),
      Effect.scoped,
    ),
  );

  assert.equal(
    execute.mock.calls.at(-1)?.arguments[0],
    "SELECT release_version FROM system.local",
  );
  assert.equal(shutdown.mock.callCount(), 1);
});

test("a connection failure preserves its cause and releases the client without initializing", async (t) => {
  const { connect, execute, shutdown } = mockClient(t);
  const cause = new Error("Connection failed");

  connect.mock.mockImplementation(() => Promise.reject(cause));

  const error = await Effect.runPromise(
    pipe(
      openRepository(["127.0.0.1"], "datacenter1"),
      Effect.flip,
      Effect.scoped,
    ),
  );

  assert.ok(error instanceof DatabaseError);
  assert.equal(error.cause, cause);

  assert.equal(execute.mock.callCount(), 0);
  assert.equal(shutdown.mock.callCount(), 1);
});

test("a schema failure stops later statements and releases the client", async (t) => {
  const { execute, shutdown } = mockClient(t);
  const cause = new Error("Season table creation failed");

  execute.mock.mockImplementation((query: string) =>
    query.includes("tournament.seasons")
      ? Promise.reject(cause)
      : Promise.resolve(),
  );

  const error = await Effect.runPromise(
    pipe(
      openRepository(["127.0.0.1"], "datacenter1"),
      Effect.flip,
      Effect.scoped,
    ),
  );

  assert.ok(error instanceof DatabaseError);
  assert.equal(error.cause, cause);

  assert.equal(execute.mock.callCount(), 2);
  assert.match(execute.mock.calls[0].arguments[0], /CREATE KEYSPACE/);
  assert.match(execute.mock.calls[1].arguments[0], /tournament\.seasons/);
  assert.equal(shutdown.mock.callCount(), 1);
});
