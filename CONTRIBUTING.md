# Contributing

Use Node.js 24 and pnpm 11.11.0. Fork the repository, create a focused branch, add a Changeset, and use test-driven development. Do not add live-network dependencies to normal tests; use fixtures under `packages/testing/fixtures`.

Before requesting review run `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`. Provider implementations must satisfy the domain `DataProvider` contract. Format handlers must preserve bounded streaming, type inference, validation issues, and formula safety. Security-sensitive changes require explicit regression tests.
