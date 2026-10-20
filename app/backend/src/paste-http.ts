import * as Effect from "effect/Effect";
import { pipe } from "effect/Function";
import { PasteRequestError, PasteTimeout } from "./domain.ts";

export type PasteFetch = (
  url: string,
  options: { readonly redirect: "manual"; readonly signal: AbortSignal },
) => Promise<Response>;

const bodyLimit = 1024 * 1024;
const allowedUrl = /^https:\/\/www\.vrpastes\.com\/[A-Za-z0-9]+$/;

const request = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: (cause) =>
      new PasteRequestError({ message: "Paste request failed", cause }),
  });

const cancelBody = (body: ReadableStream<Uint8Array> | null) =>
  body
    ? pipe(
        request(() => body.cancel()),
        Effect.catchAll((error) =>
          Effect.logWarning("Paste body cleanup failed", error),
        ),
      )
    : Effect.void;

const readBody = (response: Response) => {
  const body = response.body;
  if (!body) return Effect.succeed(Buffer.alloc(0));

  return Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    (reader) => {
      const chunks: Buffer[] = [];

      const readNext = (
        size: number,
      ): Effect.Effect<Buffer, PasteRequestError> =>
        pipe(
          request(() => reader.read()),
          Effect.flatMap(({ value, done }) => {
            if (done) return Effect.succeed(Buffer.concat(chunks, size));

            const nextSize = size + value.byteLength;

            if (nextSize > bodyLimit)
              return Effect.fail(
                new PasteRequestError({
                  message: "Paste response exceeds 1 MiB",
                }),
              );

            chunks.push(Buffer.from(value));

            return readNext(nextSize);
          }),
        );

      return readNext(0);
    },
    (reader) => Effect.sync(() => reader.releaseLock()),
  );
};

const receivePaste = (
  url: string,
  fetch: PasteFetch,
  controller: AbortController,
) =>
  pipe(
    Effect.acquireRelease(
      // Fetch acquisition must remain interruptible for the header deadline.
      Effect.interruptible(
        request(() =>
          fetch(url, {
            redirect: "manual",
            signal: controller.signal,
          }),
        ),
      ),
      (response) =>
        pipe(
          Effect.sync(() => controller.abort()),
          Effect.andThen(cancelBody(response.body)),
        ),
    ),

    Effect.flatMap((response) =>
      response.redirected || !response.ok
        ? Effect.fail(
            new PasteRequestError({
              message: `Paste returned HTTP ${response.status}`,
            }),
          )
        : readBody(response),
    ),

    Effect.timeoutFail({
      duration: "10 seconds",
      onTimeout: () => new PasteTimeout(),
    }),
  );

export const fetchPaste = (url: string, fetch: PasteFetch) => {
  if (!allowedUrl.test(url) || url.trim() !== url)
    return Effect.fail(
      new PasteRequestError({ message: "Paste URL is not allowed" }),
    );

  return pipe(
    Effect.acquireRelease(
      Effect.sync(() => new AbortController()),
      (controller) => Effect.sync(() => controller.abort()),
    ),
    Effect.flatMap((controller) => receivePaste(url, fetch, controller)),
    Effect.scoped,
  );
};
