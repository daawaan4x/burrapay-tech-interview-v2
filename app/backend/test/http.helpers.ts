import type { TestContext } from "node:test";
import * as Effect from "effect/Effect";
import { buildApp } from "../src/app.ts";
import type { Repository } from "../src/repository.ts";

export const makeTestApp = (
  t: TestContext,
  overrides: Partial<Repository> = {},
) => {
  const app = buildApp(
    {
      getSeason: () => Effect.die("Unexpected season lookup"),
      getUpload: () => Effect.die("Unexpected upload lookup"),
      findMatch: () => Effect.die("Unexpected match lookup"),
      saveMatch: () => Effect.die("Unexpected match write"),
      createSeason: () => Effect.die("Unexpected season write"),
      listSeasons: () => Effect.die("Unexpected season list"),
      saveUpload: () => Effect.die("Unexpected upload write"),
      health: () => Effect.die("Unexpected health check"),
      ...overrides,
    },
    false,
  );
  t.after(() => app.close());
  return app;
};
