FROM node:24-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/firatoezcan/firapps"

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HOST=0.0.0.0
ENV PORT=3001

RUN corepack enable

WORKDIR /app

ARG VITE_INTERNAL_API_URL=http://internal-api:4001/api/internal
ENV VITE_INTERNAL_API_URL=$VITE_INTERNAL_API_URL
ARG AUTH_PROXY_TARGET=http://internal-api:4001/api/auth
ENV AUTH_PROXY_TARGET=$AUTH_PROXY_TARGET

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps/admin-web/package.json apps/admin-web/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile --filter admin-web...

COPY apps/admin-web apps/admin-web
COPY packages/ui packages/ui

RUN pnpm exec vp run ui#build && pnpm exec vp run admin-web#build

EXPOSE 3001

CMD ["node", "apps/admin-web/.output/server/index.mjs"]
