import Fastify from "fastify";
import type { Repository } from "./repository.ts";
import { matchRoutes } from "./routes/matches.ts";
import { seasonRoutes } from "./routes/seasons.ts";
import { systemRoutes } from "./routes/system.ts";
import {
  defaultImportDependencies,
  type ImportDependencies,
} from "./routes/team-import.ts";

export const buildApp = (
  repository: Repository,
  logger = true,
  dependencies: ImportDependencies = defaultImportDependencies,
) =>
  Fastify({ logger, bodyLimit: 1024 * 1024 })
    .register(systemRoutes, { repository })
    .register(seasonRoutes, { repository })
    .register(matchRoutes, { repository, dependencies });
