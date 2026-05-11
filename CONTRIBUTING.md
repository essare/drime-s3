# Contributing to drime-s3

Thank you for helping improve drime-s3. This document is the contribution **guide** for humans and automation; GitHub may surface it when someone opens a pull request.

## Principles

- Keep changes **focused**: one logical concern per pull request when possible.
- **Match existing style**: TypeScript / Biome formatting, naming, and test patterns used nearby.
- **Do not commit secrets**: no API keys, tokens, or real session material in the repo.

## What to work on

- Check **open issues** for bugs and feature ideas.
- If you plan a large change, open an issue first so maintainers can agree on direction and avoid duplicate work.

## Development setup

1. **Install [Bun](https://bun.sh)** (use a **1.3.x** release compatible with the repo lockfiles).
2. **Clone** the repository and install dependencies:

   ```bash
   bun install --frozen-lockfile
   bun install --frozen-lockfile --cwd web
   ```

3. Run the **quality suite** before pushing (same expectations as CI):

   ```bash
   bun test
   bun run web:test
   bun run typecheck
   bun run web:typecheck
   bun run lint
   bun run web:lint
   ```

4. Run the gateway locally with `bun run dev` or `bun run start` as described in the root **README.md**.

## Pull requests

1. **Branch** from `main` with a descriptive name (for example `fix/list-objects-prefix`, `feat/admin-stats`).
2. **Commit messages**: clear, imperative subject line; optional body explaining *why* when the diff is not obvious.
3. **Description**: what changed, how to verify (commands you ran), and any breaking behavior or config changes.
4. **Tests**: add or update tests when you fix a bug or add behavior; avoid lowering coverage without discussion.
5. **Green checks**: CI is expected to pass for mergeable work.

## Issue reports

Use the repository’s **[issue templates](.github/ISSUE_TEMPLATE/)** so we get version, environment, and reproduction steps consistently.

## Code of conduct

Be respectful and constructive. Assume good intent; disagree on technical details without personal attacks.
