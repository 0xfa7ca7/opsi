# Architecture

The pnpm monorepo separates domain types and ports, core application services and `KlopsiClient`, provider adapters, configuration, secure storage/download/provenance, format/query engine, rendering, and the Commander adapter. The CLI is bundled into the public npm artifact while DuckDB and streaming parsers remain normal/optional runtime packages. `command-manifest.ts` is the normalized command/completion source; command modules adapt arguments to `KlopsiClient`. `klopsi/sdk` exports only the client and public domain types, never private workspace specifiers.

Extensions implement `DataProvider` using provider-neutral branded IDs, canonical references, capabilities, and resolved-resource classification. New formats belong behind the data-engine contract and must support bounded detection, preview, validation, conversion, and tests where applicable.

## Dependency direction and runtime flow

The domain package has no infrastructure dependency. Core depends on domain ports and coordinates catalogues, downloads, data inspection, conversion, and query services. Provider adapters depend inward on domain contracts. Storage owns cache locking, safe filenames, DNS/IP policy, atomic downloads, hashes, and provenance. Data-engine owns detection and bounded handlers. The CLI is the outer composition root: it loads configuration, constructs the OPSI provider and services, selects rendering, and attaches action callbacks to commands created from the normalized manifest.

A catalogue request flows CLI → `KlopsiClient` → `ProviderRegistry` → selected `DataProvider`; the provider validates upstream envelopes before mapping entities. A data request first resolves a local/canonical input, applies network policy where needed, stages content, invokes the selected handler, and returns domain-neutral rows/issues. Query hashes resolved content (or reuses a verified download digest), detects its format, and keys an immutable DuckDB stage by content, sheet, staging contract, and DuckDB compatibility version. A hit is linked or copied into a fresh invocation directory and opened read-only by the isolated worker; a miss stages once under a per-key build lock and publishes through the content-addressed cache. Output rendering is last so domain/core never knows terminal formats.

Experimental semantic diff resolves two inputs under nested leases, co-locates them as
`before_data` and `after_data` in a fresh invocation-local DuckDB database, closes
writable staging, and executes trusted generated SQL in the same isolated read-only
worker used by query. A key-quality aggregate rejects missing, differently typed,
null, or duplicate composite keys. A full outer join and window aggregates then
produce exact row categories while only deterministic per-category samples cross
into JavaScript memory. Identifier interpolation always uses doubled-quote SQL
escaping. Diff stages are not retained: allowing the sandbox to attach two cached
databases would broaden its external-access boundary and is deferred.

Storage owns the DuckDB-agnostic derived-artifact policy: 30-day sliding expiry, once-daily touch throttling, expired-first/LRU pruning, and a default 10 GB derived-only budget. Data-engine owns writable staging, structural verification, and prepared read-only execution. Core coordinates lookup, single-builder publication, fallback, and `hit|miss|bypass` metadata. Cache objects are rebuildable performance artifacts, not a user database or an offline-content guarantee.

Normal `dataset list` is the exception to the direct provider flow. A scheduled GitHub Actions
publisher in the public `0xfa7ca7/klopsi` source repository traverses OPSI once per day, validates and
deterministically projects the catalogue to `id`, `title`, and `name`, then uses a
repository-scoped deploy key to force-push only the generated site beneath `klopsi/` on the public,
data-only `0xfa7ca7/0xfa7ca7.github.io` repository's `gh-pages` branch. Branch-based GitHub Pages
serves those files at the fixed `https://0xfa7ca7.github.io/klopsi/` base URL. A push is not
considered a successful publication until bounded strict verification observes that run's exact
digest and generation timestamp at the public endpoint. The CLI first validates a fresh local
cache; on a cache miss it reads the HTTPS manifest and its one referenced snapshot, verifies the
complete artifact, and atomically caches it before rendering. Freshness is measured only from
`generatedAt` and is capped at 24 hours. One monotonic 8.5-second remote-operation budget spans
both reads; each read also retains the strict reader's configured per-request ceiling (9.5
seconds by default). `--refresh` checks the static publication, while `--live` alone enters the
direct, paginated provider flow. No snapshot failure silently changes modes.

This is a static trust boundary, not an application server. GitHub Pages availability and the
scheduled GitHub Actions publication are external dependencies and do not provide a hard uptime
guarantee for this project. A valid fresh local cache permits offline use during an outage;
missing, invalid, or stale cache state fails closed. See the
[catalogue service operations guide](catalogue-service.md) for the daily publication,
48-hour immutable retention, branch-based Pages setup, deploy-key rotation, public verification,
and recovery procedure.

## Public and private boundaries

Only `klopsi` and `klopsi/sdk` are public package entry points. Workspace package names, Zod schemas, DuckDB connection types, Commander internals, storage implementations, and provider wire contracts are private. The SDK declaration is intentionally hand-curated and dependency-clean; adding a public type requires updating that declaration and compiling both normal and omitted-optional clean consumers in `pack.test.ts`.

The command manifest owns every user-facing path, description, argument, option, parser kind, choice, conflict, and mandatory marker. Generic registration creates Commander objects. Command adapters only attach actions, which keeps help, parsing, surface tests, and three shell completion generators synchronized.

The public npm package contains the bundled snapshot client but no `latest.json`, retention
index, snapshot payload, or private `catalogue-snapshot` source package. Versioned publication
bytes remain external so installed clients apply the freshness and integrity policy at use time.
The public user-site repository likewise contains generated catalogue artifacts only. Source,
scheduling, and validation remain in the public source repository. The private
`CATALOGUE_DEPLOY_KEY` is an environment secret in `catalogue-production`, whose deployment
branch policy permits only the trusted default branch, so a feature-ref workflow dispatch cannot
access the publishing credential.

## Extension checklist

Provider extensions must declare capabilities, map stable IDs/references, preserve unknown upstream fields under provider metadata, honor offline caches, and emit stable `KlopsiError` categories. Format extensions must add the registered format constant, content detection, bounded preview/validation/conversion behavior, doctor fixture/probe coverage, malformed fixtures, and documentation. No extension may add telemetry, implicit network access, DuckDB extension installation, or a secret persistence path.
