FROM node:24-bookworm-slim AS runtime

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PORT=4000

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps/public-api/package.json apps/public-api/package.json
COPY packages/backend-common/package.json packages/backend-common/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile --filter public-api...

COPY apps/public-api apps/public-api
COPY packages/backend-common packages/backend-common
COPY packages/db packages/db

RUN pnpm exec vp run backend-common#build && pnpm exec vp run db#build && pnpm exec vp run public-api#build

EXPOSE 4000

CMD ["node", "apps/public-api/dist/index.js"]
