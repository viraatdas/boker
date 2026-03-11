FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --filter @boker/api... --frozen-lockfile=false

COPY apps/api apps/api
COPY packages/shared packages/shared
RUN pnpm --filter @boker/shared build
RUN pnpm --filter @boker/api build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY --from=base /app/package.json /app/pnpm-workspace.yaml /app/tsconfig.base.json ./
COPY --from=base /app/apps/api/package.json /app/apps/api/package.json
COPY --from=base /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=base /app/apps/api/dist /app/apps/api/dist
COPY --from=base /app/packages/shared/dist /app/packages/shared/dist

RUN pnpm install --prod --filter @boker/api... --frozen-lockfile=false

WORKDIR /app/apps/api
CMD ["pnpm", "start"]
