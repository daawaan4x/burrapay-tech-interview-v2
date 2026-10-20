import assert from "node:assert/strict";
import { test } from "node:test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import { pipe } from "effect/Function";
import * as Option from "effect/Option";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";
import { fetchPaste } from "../src/paste-http.ts";

const url = "https://www.vrpastes.com/Ab12";

["headers", "body"].forEach((stage) => {
  test(`caller interruption aborts stalled ${stage} and releases its resources`, {
    timeout: 5000,
  }, async (t) => {
    let started: () => void = () => undefined;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    let signal: AbortSignal | undefined;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull: () => started(),
        cancel: () => {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const fiber = Effect.runFork(
      fetchPaste(url, (_url, options) => {
        signal = options.signal;
        if (stage === "body") return Promise.resolve(new Response(body));

        started();
        return new Promise<Response>(() => {});
      }),
    );
    t.after(() => Effect.runPromise(Fiber.interrupt(fiber)));

    await ready;
    assert.equal(signal?.aborted, false);

    const exit = await Effect.runPromise(Fiber.interrupt(fiber));

    assert.ok(Exit.isInterrupted(exit));
    assert.equal(signal?.aborted, true);
    assert.equal(body.locked, false);
    assert.equal(cancelled, stage === "body");
  });
});

test("fetching preserves body bytes, uses manual redirects, and releases resources", async () => {
  let signal: AbortSignal | undefined;
  const body = Buffer.from("café &amp; notes");

  const result = await Effect.runPromise(
    fetchPaste(url, (input, options) => {
      assert.equal(input, url);
      assert.equal(options.redirect, "manual");
      signal = options.signal;
      assert.equal(signal.aborted, false);
      return Promise.resolve(new Response(body));
    }),
  );

  assert.deepEqual(result, body);
  assert.equal(signal?.aborted, true);
});

[
  "http://www.vrpastes.com/Ab12",
  "https://vrpastes.com/Ab12",
  "https://www.vrpastes.com:443/Ab12",
  "https://user@www.vrpastes.com/Ab12",
  "https://www.vrpastes.com/Ab12?x=1",
  "https://www.vrpastes.com/Ab12#x",
  "https://www.vrpastes.com/Ab12/raw",
  "https://www.vrpastes.com/%41b12",
  "https://www.vrpastes.com/",
  "https://www.vrpastes.com/Ab12\n",
].forEach((input) => {
  test(`fetch rejects disallowed URL ${JSON.stringify(input)} before network access`, async () => {
    const error = await Effect.runPromise(
      Effect.flip(
        fetchPaste(input, () => {
          assert.fail("Disallowed URL reached fetch");
        }),
      ),
    );

    assert.equal(error._tag, "PasteRequestError");
    assert.match(error.message, /URL/);
  });
});

[302, 404, 503].forEach((status) => {
  test(`HTTP ${status} fails without following a redirect and cancels its body`, async () => {
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        cancel: () => {
          cancelled = true;
        },
      }),
      { status, headers: { location: "https://elsewhere.example/" } },
    );

    const error = await Effect.runPromise(
      Effect.flip(fetchPaste(url, () => Promise.resolve(response))),
    );

    assert.equal(error._tag, "PasteRequestError");
    assert.match(error.message, new RegExp(String(status)));
    assert.equal(cancelled, true);
  });
});

[
  {
    name: "a network failure",
    fetch: (cause: Error) => Promise.reject<Response>(cause),
  },
  {
    name: "a body-stream failure",
    fetch: (cause: Error) =>
      Promise.resolve(
        new Response(
          new ReadableStream({
            start: (controller) => controller.error(cause),
          }),
        ),
      ),
  },
].forEach(({ name, fetch }) => {
  test(`${name} retains its cause`, async () => {
    const cause = new Error("Connection reset");

    const error = await Effect.runPromise(
      Effect.flip(fetchPaste(url, () => fetch(cause))),
    );

    assert.ok(error._tag === "PasteRequestError");
    assert.equal(error.cause, cause);
  });
});

test("exactly 1 MiB is accepted", async () => {
  const bytes = Buffer.alloc(1024 * 1024);

  const result = await Effect.runPromise(
    fetchPaste(url, () => Promise.resolve(new Response(bytes))),
  );

  assert.deepEqual(result, bytes);
});

test("a streamed extra byte exceeds 1 MiB regardless of the content-length header", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start: (controller) => {
        controller.enqueue(Buffer.alloc(1024 * 1024));
        controller.enqueue(Buffer.from([0]));
      },
      cancel: () => {
        cancelled = true;
      },
    }),
    { headers: { "content-length": "1" } },
  );

  const error = await Effect.runPromise(
    Effect.flip(fetchPaste(url, () => Promise.resolve(response))),
  );

  assert.equal(error._tag, "PasteRequestError");
  assert.match(error.message, /1 MiB/);
  assert.equal(cancelled, true);
});

[
  {
    name: "headers",
    response: (_cancel: () => void) => new Promise<Response>(() => {}),
    bodyCancelled: false,
  },
  {
    name: "body",
    response: (cancel: () => void) =>
      Promise.resolve(new Response(new ReadableStream({ cancel }))),
    bodyCancelled: true,
  },
].forEach(({ name, response, bodyCancelled }) => {
  test(`the 10-second deadline includes stalled ${name} and aborts the request`, {
    timeout: 5000,
  }, async () => {
    let signal: AbortSignal | undefined;
    let cancelled = false;

    const error = await Effect.runPromise(
      pipe(
        Effect.Do,
        Effect.bind("started", () => Deferred.make<void>()),
        Effect.bind("fiber", ({ started }) =>
          pipe(
            fetchPaste(url, (_url, options) => {
              signal = options.signal;
              Effect.runSync(Deferred.succeed(started, undefined));

              return response(() => {
                cancelled = true;
              });
            }),
            Effect.flip,
            Effect.fork,
          ),
        ),
        Effect.tap(({ started }) => Deferred.await(started)),
        Effect.tap(() => TestClock.adjust(9999)),
        Effect.tap(({ fiber }) =>
          Effect.map(Fiber.poll(fiber), (result) => {
            assert.ok(Option.isNone(result));
            assert.equal(signal?.aborted, false);
            assert.equal(cancelled, false);
          }),
        ),
        Effect.tap(() => TestClock.adjust(1)),
        Effect.flatMap(({ fiber }) => Fiber.join(fiber)),
        Effect.provide(TestContext.TestContext),
      ),
    );

    assert.equal(error._tag, "PasteTimeout");
    assert.equal(signal?.aborted, true);
    assert.equal(cancelled, bodyCancelled);
  });
});
