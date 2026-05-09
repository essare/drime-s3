# drime-s3

This repository hosts **drime-s3**, a Bun-powered TypeScript gateway that exposes an AWS S3–compatible HTTP API in front of [Drime Cloud](https://drime.cloud), so you can use standard S3 clients and SDKs against your Drime storage. The full design and roadmap are documented in [docs/superpowers/specs/2026-05-09-drime-s3-typescript-port-design.md](docs/superpowers/specs/2026-05-09-drime-s3-typescript-port-design.md). Install dependencies with `bun install`, then run `bun run dev` to execute the CLI entrypoint in watch mode (currently a scaffold stub).
