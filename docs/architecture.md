# Architecture

The pnpm monorepo separates domain types and ports, core application services and `OpsiClient`, provider adapters, configuration, secure storage/download/provenance, format/query engine, rendering, and the Commander adapter. The CLI is bundled into the public npm artifact while DuckDB and streaming parsers remain normal/optional runtime packages. `command-manifest.ts` is the normalized command/completion source; command modules adapt arguments to `OpsiClient`. `opsi/sdk` exports only the client and public domain types, never private workspace specifiers.

Extensions implement `DataProvider` using provider-neutral branded IDs, canonical references, capabilities, and resolved-resource classification. New formats belong behind the data-engine contract and must support bounded detection, preview, validation, conversion, and tests where applicable.

## Dependency direction and runtime flow

The domain package has no infrastructure dependency. Core depends on domain ports and coordinates catalogues, downloads, data inspection, conversion, and query services. Provider adapters depend inward on domain contracts. Storage owns cache locking, safe filenames, DNS/IP policy, atomic downloads, hashes, and provenance. Data-engine owns detection and bounded handlers. The CLI is the outer composition root: it loads configuration, constructs the OPSI provider and services, selects rendering, and attaches action callbacks to commands created from the normalized manifest.

A catalogue request flows CLI → `OpsiClient` → `ProviderRegistry` → selected `DataProvider`; the provider validates upstream envelopes before mapping entities. A data request first resolves a local/canonical input, applies network policy where needed, stages content, invokes the selected handler, and returns domain-neutral rows/issues. Query adds an isolated worker and read-only DuckDB database. Output rendering is last so domain/core never knows terminal formats.

## Public and private boundaries

Only `opsi` and `opsi/sdk` are public package entry points. Workspace package names, Zod schemas, DuckDB connection types, Commander internals, storage implementations, and provider wire contracts are private. The SDK declaration is intentionally hand-curated and dependency-clean; adding a public type requires updating that declaration and compiling both normal and omitted-optional clean consumers in `pack.test.ts`.

The command manifest owns every user-facing path, description, argument, option, parser kind, choice, conflict, and mandatory marker. Generic registration creates Commander objects. Command adapters only attach actions, which keeps help, parsing, surface tests, and three shell completion generators synchronized.

## Extension checklist

Provider extensions must declare capabilities, map stable IDs/references, preserve unknown upstream fields under provider metadata, honor offline caches, and emit stable `OpsiError` categories. Format extensions must add the registered format constant, content detection, bounded preview/validation/conversion behavior, doctor fixture/probe coverage, malformed fixtures, and documentation. No extension may add telemetry, implicit network access, DuckDB extension installation, or a secret persistence path.
