import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import * as ConfigError from "effect/ConfigError";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import { loadPasteFetch, PasteFixtureError } from "../src/paste-source.ts";
import { defaultImportDependencies } from "../src/routes/team-import.ts";

const run = <A, E>(effect: Effect.Effect<A, E>, mode?: string) => {
  const values = new Map(
    mode === undefined ? [] : [["PASTE_FETCH_MODE", mode]],
  );
  const provider = ConfigProvider.fromMap(values);

  return Effect.runPromise(effect.pipe(Effect.withConfigProvider(provider)));
};

const options = () => ({
  redirect: "manual" as const,
  signal: new AbortController().signal,
});

[undefined, "live"].forEach((mode) => {
  test(`${mode ?? "unset"} mode selects live fetch without reading fixtures`, async () => {
    const fetch = await run(
      loadPasteFetch(() => {
        assert.fail("Live mode must not read fixtures");
      }),
      mode,
    );

    assert.equal(fetch, defaultImportDependencies.fetch);
  });
});

test("an unknown mode fails configuration", async () => {
  const error = await run(Effect.flip(loadPasteFetch()), "fixture");

  assert.ok(ConfigError.isConfigError(error));
  assert.ok(String(error).includes("PASTE_FETCH_MODE"));
});

test("fixture mode returns the corresponding HTML in fresh responses", async () => {
  const fetch = await run(loadPasteFetch(), "fixtures");

  await Promise.all(
    ["tgiS1Swl", "VvVArqgO"].map(async (id) => {
      const expected = await readFile(
        new URL(`./fixtures/vrpaste-${id}-complete.html`, import.meta.url),
        "utf8",
      );
      const first = await fetch(`https://www.vrpastes.com/${id}`, options());
      const second = await fetch(`https://www.vrpastes.com/${id}`, options());

      assert.equal(first.status, 200);
      assert.equal(
        first.headers.get("content-type"),
        "text/html; charset=utf-8",
      );
      assert.notEqual(first, second);
      assert.equal(await first.text(), expected);
      assert.equal(await second.text(), expected);
    }),
  );
});

test("fixture mode returns 404 for unmapped or altered URLs without live fetching", async (t) => {
  const live = t.mock.method(globalThis, "fetch", () => {
    assert.fail("Fixture mode must not make network requests");
  });
  const fetch = await run(loadPasteFetch(), "fixtures");

  await Promise.all(
    [
      "https://www.vrpastes.com/unknown",
      "https://www.vrpastes.com/tgiS1Swl?extra=1",
      "https://example.com/tgiS1Swl",
    ].map(async (url) => {
      const response = await fetch(url, options());

      assert.equal(response.status, 404);
    }),
  );

  assert.equal(live.mock.callCount(), 0);
});

test("fixture mode rejects an already aborted request", async () => {
  const fetch = await run(loadPasteFetch(), "fixtures");
  const reason = new Error("Request cancelled");

  await assert.rejects(
    fetch("https://www.vrpastes.com/tgiS1Swl", {
      redirect: "manual",
      signal: AbortSignal.abort(reason),
    }),
    (error) => error === reason,
  );
});

test("a fixture read failure prevents selecting the fixture fetch", async () => {
  const cause = new Error("Fixture file is missing");
  const error = await run(
    Effect.flip(loadPasteFetch(() => Promise.reject(cause))),
    "fixtures",
  );

  assert.ok(error instanceof PasteFixtureError);
  assert.equal(error.cause, cause);
  assert.match(error.message, /Could not load paste fixture/);
});
