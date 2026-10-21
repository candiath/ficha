# Production image of the API, built by .github/workflows/image.yml and run on
# the VPS (ops/). Render does not use it: it still builds from source.
# Built from the repository root: docker build -f apps/api/Dockerfile .

FROM node:22-bookworm-slim AS build
# Prisma 5 picks its query engine from the system's OpenSSL when it installs,
# so the build stage needs OpenSSL as much as the runtime stage does.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Manifests first: the `npm ci` layer is reused until a dependency changes.
# `npm ci` checks every workspace in the lockfile, so the web's package.json
# comes along even though the image ships only the API.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
# --ignore-scripts: the root `prepare` script runs `git config`, and there is
# no git repository here. Prisma's own install scripts (they fetch the engines)
# are then run on purpose with `npm rebuild`.
RUN npm ci --ignore-scripts && npm rebuild prisma @prisma/engines @prisma/client

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w packages/shared \
 && npm run build -w apps/api \
 && npm prune --omit=dev --ignore-scripts

FROM node:22-bookworm-slim
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production
LABEL org.opencontainers.image.source=https://github.com/candiath/ficha

# The commit this image was built from. The app reads it as RENDER_GIT_COMMIT
# (Render's name for it) to report `buildMarker` in /health, so a deploy can
# check which commit is serving.
ARG GIT_COMMIT=local
ENV RENDER_GIT_COMMIT=$GIT_COMMIT

WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/apps/api ./apps/api
WORKDIR /app/apps/api
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
