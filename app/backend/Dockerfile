FROM node:24-bookworm-slim AS base
WORKDIR /app
RUN npm install --global pnpm@12.4.2
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY app/backend/package.json ./app/backend/package.json
COPY app/frontend/package.json ./app/frontend/package.json

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @repo/backend...
COPY app/backend/tsconfig.json ./app/backend/tsconfig.json
COPY app/backend/src ./app/backend/src
RUN pnpm --filter @repo/backend build

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
RUN pnpm install --frozen-lockfile --prod --filter @repo/backend...
COPY --from=build /app/app/backend/dist ./app/backend/dist
COPY app/backend/test/fixtures/vrpaste-tgiS1Swl-complete.html \
     app/backend/test/fixtures/vrpaste-VvVArqgO-complete.html \
     ./app/backend/test/fixtures/
USER node
EXPOSE 3001
CMD ["node", "app/backend/dist/index.js"]
