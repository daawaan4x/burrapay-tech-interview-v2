import Fastify from "fastify";
import type { Repository } from "./repository.ts";
import { matchRoutes } from "./routes/matches.ts";
import { seasonRoutes } from "./routes/seasons.ts";
import { systemRoutes } from "./routes/system.ts";

export const buildApp = (repository: Repository, logger = true) =>
  Fastify({ logger, bodyLimit: 1024 * 1024 })
    .register(systemRoutes, { repository })
    .register(seasonRoutes, { repository })
    .register(matchRoutes, { repository });
