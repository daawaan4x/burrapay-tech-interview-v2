FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm install --global pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY app/backend/package.json ./app/backend/package.json
COPY app/frontend/package.json ./app/frontend/package.json
RUN pnpm install --frozen-lockfile --filter @repo/frontend...
COPY app/frontend ./app/frontend
RUN pnpm --filter @repo/frontend build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/app/frontend/.next/standalone ./
COPY --from=build --chown=node:node /app/app/frontend/.next/static ./app/frontend/.next/static
USER node
EXPOSE 3000
CMD ["node", "app/frontend/server.js"]
