FROM oven/bun:1.3.13-alpine AS web-build
ARG APP_VERSION=dev
ARG COMMIT_SHA=unknown
WORKDIR /app/web

COPY package.json /app/package.json
COPY web/package.json web/bun.lock ./
RUN bun install --frozen-lockfile

COPY web/ ./
ENV VITE_APP_VERSION=${APP_VERSION}
ENV VITE_COMMIT_SHA=${COMMIT_SHA}
RUN bun run build

FROM oven/bun:1.3.13-alpine AS server-build
ARG APP_VERSION=dev
ARG COMMIT_SHA=unknown
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY tsconfig.json ./
COPY drime-swagger.yaml ./

# build-release.ts rebuilds the UI before copying it next to the binary, so
# reuse the prepared web workspace from the previous stage.
COPY --from=web-build /app/web ./web
ENV COMMIT_SHA=${COMMIT_SHA}
RUN bun run scripts/build-release.ts

FROM alpine:3.20 AS runtime
RUN apk add --no-cache libstdc++ libgcc ca-certificates

WORKDIR /app
COPY --from=server-build /app/dist/main /usr/local/bin/drime-s3
COPY --from=server-build /app/dist/web /usr/local/bin/web

EXPOSE 8081
ENV NODE_ENV=production
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8081/_health || exit 1

ENTRYPOINT ["/usr/local/bin/drime-s3"]
CMD ["serve", "--host", "0.0.0.0", "--port", "8081"]
