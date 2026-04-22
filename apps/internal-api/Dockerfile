FROM node:24-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/firatoezcan/firapps"

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV PORT=4001

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps/internal-api/package.json apps/internal-api/package.json
COPY packages/backend-common/package.json packages/backend-common/package.json
COPY packages/db/package.json packages/db/package.json

RUN pnpm install --frozen-lockfile --filter internal-api...

COPY apps/internal-api apps/internal-api
COPY packages/backend-common packages/backend-common
COPY packages/db packages/db

RUN pnpm exec vp run backend-common#build && pnpm exec vp run db#build && pnpm exec vp run internal-api#build

EXPOSE 4001

CMD ["node", "apps/internal-api/dist/index.js"]
