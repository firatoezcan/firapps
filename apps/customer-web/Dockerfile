FROM node:24-bookworm-slim AS runtime

LABEL org.opencontainers.image.source="https://github.com/firatoezcan/firapps"

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV HOST=0.0.0.0
ENV PORT=3000

RUN corepack enable

WORKDIR /app

ARG VITE_PUBLIC_API_URL=http://public-api:4000/api/public
ENV VITE_PUBLIC_API_URL=$VITE_PUBLIC_API_URL
ARG AUTH_PROXY_TARGET=http://internal-api:4001/api/auth
ENV AUTH_PROXY_TARGET=$AUTH_PROXY_TARGET

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json vite.config.ts ./
COPY apps/customer-web/package.json apps/customer-web/package.json
COPY packages/ui/package.json packages/ui/package.json

RUN pnpm install --frozen-lockfile --filter customer-web...

COPY apps/customer-web apps/customer-web
COPY packages/ui packages/ui

RUN pnpm exec vp run ui#build && pnpm exec vp run customer-web#build

EXPOSE 3000

CMD ["node", "apps/customer-web/.output/server/index.mjs"]
