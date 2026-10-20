import assert from "node:assert/strict";
import { test } from "node:test";
import { Client, type QueryOptions } from "cassandra-driver";
import { cleanupSeasons, localDataCenter } from "./helpers.ts";

test("cleanup attempts every owned table and reports failed deletes", async (t) => {
  const client = new Client({ contactPoints: ["127.0.0.1"], localDataCenter });
  const cause = new Error("One delete failed");
  const execute = t.mock.method(
    client,
    "execute",
    (query: string, _parameters: unknown[], _options: QueryOptions) =>
      query.includes("match_uploads")
        ? Promise.reject(cause)
        : Promise.resolve(),
  );

  await assert.rejects(cleanupSeasons(client, [7]), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [cause]);
    return true;
  });
  assert.deepEqual(
    execute.mock.calls.map((call) => call.arguments[0]).sort(),
    [
      "DELETE FROM tournament.matches WHERE season_number = ?",
      "DELETE FROM tournament.match_uploads WHERE season_number = ?",
      "DELETE FROM tournament.seasons WHERE season_number = ?",
    ].sort(),
  );

  execute.mock.calls.forEach((call) => {
    assert.deepEqual(call.arguments[1], [7]);
    assert.deepEqual(call.arguments[2], { prepare: true });
  });
});
