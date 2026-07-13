# Catalogue Snapshot Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `opsi dataset list` use a centrally generated, reusable catalogue snapshot that is always younger than 24 hours while retaining explicit `--refresh` and `--live` modes.

**Architecture:** A new private workspace package owns the versioned snapshot schemas, generator, secure remote reader, cache store, and publisher commands. A scheduled GitHub Pages workflow runs the proven 300-row live traversal every six hours and publishes compact immutable JSON snapshots plus `latest.json` and a 48-hour retention index. The CLI validates and caches the compact snapshot before rendering and never silently falls back to live OPSI traversal.

**Tech Stack:** Node.js 24, TypeScript 6, pnpm 11.11, Zod 4, Undici, Vitest 4, Commander 15, GitHub Actions, GitHub Pages.

## Global Constraints

- Snapshot freshness is measured from `generatedAt` and must never exceed 24 hours.
- The publisher runs every six hours and uses serial 300-row OPSI pages.
- Normal `dataset list` makes no OPSI request and has a hard ten-second snapshot-network timeout.
- Snapshot mode contains and supports only `id`, `title`, and `name`.
- Missing, stale, malformed, oversized, or integrity-invalid snapshots fail quickly with exit category 4.
- `--live` is the only mode allowed to execute direct OPSI pagination.
- `--refresh` refreshes the published snapshot and conflicts with `--live` and `--offline`.
- Offline mode accepts only a valid locally cached snapshot younger than 24 hours.
- All production snapshot URLs are HTTPS and remain on the compile-time GitHub Pages origin.
- Snapshots are never committed to `master` and never included in the npm package.
- Normal automated tests use controlled fixtures and make no OPSI or GitHub Pages requests.
- Existing Node 24 release targets and exact-install lanes remain supported.

---

### Task 1: Versioned snapshot contracts and deterministic generator

**Files:**
- Create: `packages/catalogue-snapshot/package.json`
- Create: `packages/catalogue-snapshot/tsconfig.json`
- Create: `packages/catalogue-snapshot/src/contracts.ts`
- Create: `packages/catalogue-snapshot/src/generator.ts`
- Create: `packages/catalogue-snapshot/src/index.ts`
- Create: `packages/catalogue-snapshot/test/contracts.test.ts`
- Create: `packages/catalogue-snapshot/test/generator.test.ts`
- Modify: `vitest.config.ts`

**Interfaces:**
- Consumes: `DataProvider.search(query: SearchQuery): Promise<SearchPage>` from `@opsi/domain`.
- Produces: `CatalogueDataset`, `CatalogueManifest`, `CatalogueSnapshot`, `CatalogueIndex`, `parseCatalogueManifest`, `parseCatalogueSnapshot(bytes, manifest?)`, `parseCatalogueIndex`, `assertSnapshotFresh`, `serializeSnapshot`, and `generateCatalogueSnapshot` from `@opsi/catalogue-snapshot`.

- [ ] **Step 1: Add failing contract tests**

Create strict-schema tests that accept the approved version-1 examples and reject unknown keys, empty strings, duplicate IDs, count/timestamp mismatches, unsafe paths, bad digests, incorrect ordering, snapshots older than 24 hours, and timestamps more than five minutes in the future. Use a fixed `now` of `2026-07-13T12:00:00.000Z` and assert these exact exported calls:

```ts
const manifest = parseCatalogueManifest(value);
const snapshot = parseCatalogueSnapshot(bytes, manifest);
expect(() => assertSnapshotFresh(snapshot.generatedAt, now)).not.toThrow();
expect(snapshot.datasets.map(({ id }) => id)).toEqual(["a", "b"]);
```

- [ ] **Step 2: Run the contract test and verify the missing package failure**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/contracts.test.ts`

Expected: FAIL because `@opsi/catalogue-snapshot` and its exports do not exist.

- [ ] **Step 3: Create the workspace package and strict version-1 schemas**

Use this package boundary:

```json
{
  "name": "@opsi/catalogue-snapshot",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@opsi/domain": "workspace:*",
    "@opsi/provider-opsi": "workspace:*",
    "@opsi/storage": "workspace:*",
    "zod": "4.4.3"
  }
}
```

Define these exact public types and constants in `contracts.ts`:

```ts
export const CATALOGUE_SCHEMA_VERSION = "1" as const;
export const CATALOGUE_MAX_AGE_MS = 24 * 60 * 60 * 1_000;
export const CATALOGUE_FUTURE_TOLERANCE_MS = 5 * 60 * 1_000;
export const CATALOGUE_MAX_MANIFEST_BYTES = 64 * 1_024;
export const CATALOGUE_MAX_SNAPSHOT_BYTES = 10 * 1_024 * 1_024;

export interface CatalogueDataset {
  readonly id: string;
  readonly title: string;
  readonly name: string;
}
export interface CatalogueManifest {
  readonly schemaVersion: "1";
  readonly generatedAt: string;
  readonly snapshotPath: string;
  readonly count: number;
  readonly bytes: number;
  readonly sha256: string;
}
export interface CatalogueSnapshot {
  readonly schemaVersion: "1";
  readonly generatedAt: string;
  readonly count: number;
  readonly datasets: readonly CatalogueDataset[];
}
export interface CatalogueIndex {
  readonly schemaVersion: "1";
  readonly snapshots: readonly CatalogueManifest[];
}
```

All parser failures must throw `OpsiError` with `CATALOGUE_SNAPSHOT_INVALID`, exit code 4, and context that identifies only the failed field, never raw remote content. `parseCatalogueSnapshot` validates internal invariants without a manifest and additionally validates bytes, digest, count, and timestamp against the manifest when one is supplied. Integrity mismatch must throw `CATALOGUE_SNAPSHOT_INTEGRITY`. Staleness must throw `CATALOGUE_SNAPSHOT_STALE`. Serialize snapshots as one UTF-8 JSON line with a trailing newline so byte length and digest are deterministic.

- [ ] **Step 4: Run the contract test and verify it passes**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/contracts.test.ts`

Expected: PASS with all strict schema, integrity, ordering, and freshness cases green.

- [ ] **Step 5: Add failing generator tests**

Use a fake `DataProvider` that returns offsets `0`, `300`, and `600`. Assert calls use `{ limit: 300, offset }`, raw names are projected, results are sorted by `name` then `id`, the source count is preserved, missing/non-string names fail, and a non-advancing `nextOffset` throws `CATALOGUE_PAGINATION_INVALID`. Assert the exported function signature:

```ts
const snapshot = await generateCatalogueSnapshot(provider, {
  generatedAt: "2026-07-13T12:00:00.000Z",
});
```

- [ ] **Step 6: Run the generator test and verify it fails**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/generator.test.ts`

Expected: FAIL because `generateCatalogueSnapshot` is not exported.

- [ ] **Step 7: Implement deterministic serial generation**

Implement `generateCatalogueSnapshot(provider, options)` with `DATASET_PAGE_SIZE = 300`. Advance only through the provider's returned `nextOffset`, require the first-page total to equal final record count, reject changing totals, map `providerMetadata.raw.name`, sort with `left.name.localeCompare(right.name) || left.id.localeCompare(right.id)`, then pass the result through the strict snapshot parser before returning it. Do not add concurrency or a larger page-size option.

- [ ] **Step 8: Register the Vitest alias and run package tests**

Add `"@opsi/catalogue-snapshot": workspacePackage("./packages/catalogue-snapshot/src/index.ts")` to `vitest.config.ts`.

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/contracts.test.ts packages/catalogue-snapshot/test/generator.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit the contracts and generator**

```bash
git add packages/catalogue-snapshot vitest.config.ts pnpm-lock.yaml
git commit -m "feat: add catalogue snapshot contracts"
```

---

### Task 2: Secure remote retrieval and atomic catalogue cache

**Files:**
- Create: `packages/catalogue-snapshot/src/remote.ts`
- Create: `packages/catalogue-snapshot/src/store.ts`
- Create: `packages/catalogue-snapshot/src/client.ts`
- Create: `packages/catalogue-snapshot/test/remote.integration.test.ts`
- Create: `packages/catalogue-snapshot/test/client.integration.test.ts`
- Modify: `packages/catalogue-snapshot/src/index.ts`
- Modify: `packages/storage/src/download.ts`
- Modify: `packages/storage/test/download.test.ts`
- Modify: `packages/storage/src/index.ts`

**Interfaces:**
- Consumes: `Downloader`, `ContentCache`, `CacheLock`, and `CacheLayout` from `@opsi/storage`.
- Produces: `StrictHttpsReader.read(relativePath, maxBytes)`, `CatalogueSnapshotStore.read/write/withLock`, `ContentCacheCatalogueSnapshotStore`, and `CatalogueSnapshotClient.list({ refresh? })`.

- [ ] **Step 1: Add a failing same-origin redirect-policy test to storage**

Extend `DownloadInput` with `readonly allowedOrigins?: readonly string[]`. Add a controlled redirect test asserting a request from `https://public.example/start` to `https://other.example/snapshot.json` fails with `DOWNLOAD_ORIGIN_FORBIDDEN` before the second request, while a same-origin redirect succeeds.

- [ ] **Step 2: Run the storage integration test and verify it fails**

Run: `pnpm exec vitest run --project integration packages/storage/test/download.test.ts -t "allowed origin"`

Expected: FAIL because `allowedOrigins` is not enforced.

- [ ] **Step 3: Enforce allowed origins inside the downloader redirect loop**

Normalize configured origins once with `new URL(origin).origin`. Validate the initial URL and every redirect target before opening a dispatcher. Throw an exit-4 `OpsiError` with code `DOWNLOAD_ORIGIN_FORBIDDEN`, omit the rejected full URL from the message, and include only `{ origin: next.origin }` in context. Export the updated input type through the existing storage index.

- [ ] **Step 4: Re-run storage tests**

Run: `pnpm exec vitest run --project integration packages/storage/test/download.test.ts`

Expected: PASS.

- [ ] **Step 5: Add failing remote-reader integration tests**

Use local HTTP fixture servers with injected `Downloader` policy allowances only inside the test constructor. Cover manifest size overflow, snapshot size overflow, non-2xx status, timeout, cross-origin redirect, malformed JSON, safe relative-path resolution, and successful exact-byte retrieval. The production constructor must default to:

```ts
export const DEFAULT_CATALOGUE_BASE_URL = "https://0xfa7ca7.github.io/opsi/";
new StrictHttpsReader({
  baseUrl: DEFAULT_CATALOGUE_BASE_URL,
  timeoutMs: 10_000,
});
```

- [ ] **Step 6: Implement the strict remote reader**

`StrictHttpsReader.read(relativePath, maxBytes)` must resolve only relative paths beneath the configured base pathname, reject credentials/query/fragment/traversal, use `Downloader` with `allowedOrigins: [base.origin]`, read the completed regular file, and delete its temporary directory in `finally`. Map retrieval failures to `CATALOGUE_SNAPSHOT_UNAVAILABLE` while preserving already typed snapshot validation errors.

- [ ] **Step 7: Run remote-reader tests**

Run: `pnpm exec vitest run --project integration packages/catalogue-snapshot/test/remote.integration.test.ts`

Expected: PASS.

- [ ] **Step 8: Add failing cache/client integration tests**

Create a temporary `ContentCache`, fake `StrictHttpsReader`, and fixed clock. Cover:

- fresh cached snapshot makes zero remote calls;
- cold cache reads `v1/latest.json` and exactly one referenced snapshot;
- cache TTL equals remaining time to `generatedAt + 24h`;
- `refresh: true` reads the manifest even with a fresh cache;
- identical remote digest reuses the verified cached object;
- stale remote, stale offline cache, digest mismatch, invalid ordering, and duplicate IDs fail;
- two concurrent cold calls produce one remote manifest/snapshot pair;
- a remote failure never invokes any live provider function.

Use this public result contract:

```ts
export interface CatalogueListResult {
  readonly datasets: readonly CatalogueDataset[];
  readonly generatedAt: string;
  readonly source: "snapshot-cache" | "snapshot-remote";
}

await client.list({ refresh: false });
```

- [ ] **Step 9: Implement the content-cache store and client**

Use cache metadata key `catalogue-snapshot:v1`, schema `catalogue-snapshot-cache-v1`, and the existing object store for exact snapshot bytes. `withLock` must acquire `catalogue-snapshot:v1` under `cache.layout().locks`, recheck cache after acquiring, and release in `finally`. Always read cache metadata with `includeExpired: true` and apply freshness against the injected clock; cache record creation time must never determine acceptance. On online cache corruption, fetch and replace from remote. In offline mode, return only a valid fresh cache or throw the typed stale/unavailable error.

- [ ] **Step 10: Run client, storage, and type tests**

Run: `pnpm exec vitest run --project integration packages/catalogue-snapshot/test/client.integration.test.ts packages/catalogue-snapshot/test/remote.integration.test.ts packages/storage/test/download.test.ts`

Expected: PASS.

Run: `pnpm --filter @opsi/catalogue-snapshot typecheck`

Expected: PASS.

- [ ] **Step 11: Commit secure retrieval and caching**

```bash
git add packages/catalogue-snapshot packages/storage vitest.config.ts pnpm-lock.yaml
git commit -m "feat: securely cache catalogue snapshots"
```

---

### Task 3: Snapshot-backed CLI behavior

**Files:**
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`
- Modify: `apps/cli/src/program.ts`
- Modify: `apps/cli/src/command-manifest.ts`
- Modify: `apps/cli/src/commands/dataset.ts`
- Modify: `packages/output/src/index.ts`
- Modify: `packages/output/test/output.test.ts`
- Modify: `apps/cli/test/final-regressions.test.ts`
- Modify: `apps/cli/test/catalog.e2e.test.ts`
- Create: `apps/cli/test/catalogue-snapshot.integration.test.ts`
- Modify: `docs/commands.md`

**Interfaces:**
- Consumes: `CatalogueSnapshotClient.list({ refresh? })` and existing `OpsiClient.search`.
- Produces: `opsi dataset list [--refresh|--live]` with snapshot metadata and explicit live pagination.

- [ ] **Step 1: Add failing command-manifest and command-unit tests**

Change the expected normalized manifest entry to:

```ts
{
  path: "dataset list",
  description: "List all datasets",
  arguments: [],
  options: [
    { flags: "--refresh", description: "refresh the published catalogue snapshot", conflicts: ["live"] },
    { flags: "--live", description: "query OPSI directly using paginated requests", conflicts: ["refresh"] },
  ],
}
```

Add unit tests proving default and `--refresh` call the snapshot client, `--live` alone calls `OpsiClient.search`, `--live --offline` fails with exit 2, and unsupported snapshot fields fail with `CATALOGUE_SNAPSHOT_FIELD_UNSUPPORTED` plus a `--live` suggestion.

- [ ] **Step 2: Run focused CLI tests and verify they fail**

Run: `pnpm exec vitest run --project unit apps/cli/test/final-regressions.test.ts -t "dataset list|snapshot"`

Expected: FAIL because the options and snapshot dependency are missing.

- [ ] **Step 3: Wire the package and dependency injection**

Add `@opsi/catalogue-snapshot` as a workspace dependency and TypeScript path. Extend program construction with an optional dependency object so tests can inject a fake snapshot client:

```ts
export interface ProgramDependencies {
  readonly catalogue?: Pick<CatalogueSnapshotClient, "list">;
}

export function createProgram(
  context: CliContext,
  dependencies: ProgramDependencies = {},
): Command;
```

Production construction creates `ContentCacheCatalogueSnapshotStore` from the existing cache, `StrictHttpsReader` with the fixed Pages base URL, and `CatalogueSnapshotClient` with configuration offline state. Do not add a user-configurable production snapshot origin.

Add a read-only `Renderer.fields` getter that returns the configured field projection so command validation uses the same parsed field list that rendering uses. Cover the getter in `packages/output/test/output.test.ts`; do not parse `process.argv` again inside the dataset command.

- [ ] **Step 4: Split snapshot and live list paths**

Keep the current loop as a private `listLiveDatasets` helper. Add a snapshot helper that permits only the selected fields `id`, `title`, and `name`, calls `catalogue.list({ refresh: options.refresh === true })`, and writes one validated dataset array with:

```ts
{
  total: result.datasets.length,
  count: result.datasets.length,
  source: result.source,
  generatedAt: result.generatedAt,
  stale: false,
}
```

Live JSON metadata remains `{ total, count, pages, source: "live" }`; streamed formats retain page-at-a-time output. `--live` and `--refresh` are command-local options. Reject `--live` whenever `context.configuration?.offline === true`.

- [ ] **Step 5: Run command unit tests**

Run: `pnpm exec vitest run --project unit apps/cli/test/final-regressions.test.ts`

Expected: PASS.

- [ ] **Step 6: Convert existing spawned live E2E coverage and add snapshot integration coverage**

Change existing fixture calls that expect `/package_search` to invoke `dataset list --live`. In the new integration test, construct `createProgram` with a real renderer and injected snapshot client, then verify table, JSON, NDJSON, CSV, and TSV output; supported field reordering; `--refresh`; source metadata; option conflicts; offline rejection; and zero provider searches in normal mode.

- [ ] **Step 7: Run CLI E2E and integration tests**

Run: `pnpm build && pnpm exec vitest run --project integration apps/cli/test/catalogue-snapshot.integration.test.ts && pnpm exec vitest run --project cli-e2e apps/cli/test/catalog.e2e.test.ts`

Expected: PASS.

- [ ] **Step 8: Update command documentation**

Document the 24-hour snapshot default, three supported snapshot fields, `--refresh`, explicit slow `--live`, no silent fallback, offline freshness rule, source metadata, and the fact that live output alone streams provider pages.

- [ ] **Step 9: Commit CLI integration**

```bash
git add apps/cli docs/commands.md packages/catalogue-snapshot pnpm-lock.yaml
git commit -m "feat: list datasets from fresh snapshots"
```

---

### Task 4: Static publisher, retention index, and public verifier

**Files:**
- Create: `packages/catalogue-snapshot/src/publication.ts`
- Create: `packages/catalogue-snapshot/src/publish-entry.ts`
- Create: `packages/catalogue-snapshot/src/verify-entry.ts`
- Create: `packages/catalogue-snapshot/test/publication.test.ts`
- Create: `packages/catalogue-snapshot/test/publisher.integration.test.ts`
- Modify: `packages/catalogue-snapshot/package.json`
- Modify: `packages/catalogue-snapshot/src/index.ts`

**Interfaces:**
- Consumes: `generateCatalogueSnapshot`, strict parsers, `OpsiProvider`, `OpsiTransport`, and `RequestScheduler`.
- Produces: `buildPublication`, `retainPriorSnapshots`, executable publisher, executable public verifier, and a Pages-ready `site/v1` directory.

- [ ] **Step 1: Add failing publication tests**

Test that `buildPublication(snapshot)` returns deterministic bytes and this exact manifest relationship:

```ts
const publication = buildPublication(snapshot);
expect(publication.manifest.bytes).toBe(publication.snapshotBytes.byteLength);
expect(publication.manifest.sha256).toBe(
  createHash("sha256").update(publication.snapshotBytes).digest("hex"),
);
expect(publication.manifest.snapshotPath).toBe(
  "v1/snapshots/2026-07-13T12-00-00.000Z.json",
);
```

Test the 10% prior-count reduction guard, explicit manual override, 48-hour retention cutoff, invalid prior index rejection, duplicate retained paths, and deterministic index order.

- [ ] **Step 2: Run publication tests and verify they fail**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/publication.test.ts`

Expected: FAIL because publication functions do not exist.

- [ ] **Step 3: Implement publication assembly**

Expose:

```ts
export interface CataloguePublication {
  readonly manifest: CatalogueManifest;
  readonly snapshotBytes: Uint8Array;
}
export function buildPublication(snapshot: CatalogueSnapshot): CataloguePublication;
export function assertSafeCount(previous: number | undefined, next: number, allowReduction: boolean): void;
export function retainedManifests(index: CatalogueIndex | undefined, now: Date): readonly CatalogueManifest[];
```

Filename timestamps replace only `:` with `-`; snapshot JSON keeps the original ISO timestamp. The retention cutoff is exactly `now - 48h`. The index contains retained manifests plus the new manifest, sorted newest first.

- [ ] **Step 4: Add failing publisher integration tests**

Run the entrypoint against a controlled OPSI HTTP fixture and a controlled previous-site fixture. Assert it writes only:

```text
site/v1/latest.json
site/v1/index.json
site/v1/snapshots/<current>.json
site/v1/snapshots/<retained>.json
```

Assert all JSON files end with one newline, an invalid prior artifact is not copied, a greater-than-10% count drop fails without the manual flag, and `deployment.json` records the new digest and timestamp for workflow outputs.

- [ ] **Step 5: Implement publisher and verifier entrypoints**

Add package scripts:

```json
{
  "generate": "node dist/publish-entry.js",
  "verify-public": "node dist/verify-entry.js"
}
```

`publish-entry` accepts exact arguments `--output`, `--previous-base-url`, and optional `--allow-large-reduction`. It creates an `OpsiProvider` with the existing default gateway and scheduler, fetches the prior index through `StrictHttpsReader`, treats only an index `404` as first publication, aborts on every other prior retrieval or validation failure, copies validated retained snapshots, generates the current snapshot, writes the site atomically inside the workflow directory, and prints one JSON result to stdout.

`verify-entry` accepts `--base-url`, `--expected-sha256`, and `--expected-generated-at`; it adds a cache-busting query only to `latest.json`, validates the public manifest and referenced immutable snapshot through the same parsers, and exits nonzero unless digest and timestamp exactly match the expected deployment.

- [ ] **Step 6: Run publisher tests and build**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/publication.test.ts && pnpm exec vitest run --project integration packages/catalogue-snapshot/test/publisher.integration.test.ts`

Expected: PASS.

Run: `pnpm --filter @opsi/catalogue-snapshot build`

Expected: PASS and `dist/publish-entry.js` plus `dist/verify-entry.js` exist.

- [ ] **Step 7: Commit publisher code**

```bash
git add packages/catalogue-snapshot pnpm-lock.yaml
git commit -m "feat: publish compact catalogue snapshots"
```

---

### Task 5: Scheduled GitHub Pages deployment

**Files:**
- Create: `.github/workflows/catalogue-snapshot.yml`
- Create: `docs/catalogue-service.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `pnpm --filter @opsi/catalogue-snapshot generate` and `verify-public`.
- Produces: `https://0xfa7ca7.github.io/opsi/v1/latest.json` and immutable snapshot URLs.

- [ ] **Step 1: Add a static workflow contract test**

Create a unit test in `packages/catalogue-snapshot/test/workflow.test.ts` that parses `.github/workflows/catalogue-snapshot.yml` as text and asserts: six-hour cron `17 */6 * * *`, `workflow_dispatch`, top-level concurrency with `cancel-in-progress: false`, exact permissions per job, default-branch checkout, frozen lockfile install, generate/deploy/verify jobs, the `github-pages` environment, and immutable 40-character action pins.

- [ ] **Step 2: Run the workflow test and verify it fails**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/workflow.test.ts`

Expected: FAIL because the workflow does not exist.

- [ ] **Step 3: Create the scheduled Pages workflow**

Use this job graph and exact official action pins verified on 2026-07-13:

```yaml
name: Catalogue snapshot

on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:
    inputs:
      allow_large_reduction:
        description: Allow publishing a catalogue reduction greater than 10 percent
        required: false
        type: boolean
        default: false

concurrency:
  group: catalogue-pages
  cancel-in-progress: false

jobs:
  generate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      sha256: ${{ steps.snapshot.outputs.sha256 }}
      generated-at: ${{ steps.snapshot.outputs.generated-at }}
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          ref: ${{ github.event.repository.default_branch }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24
      - run: corepack enable && corepack prepare pnpm@11.11.0 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @opsi/catalogue-snapshot build
      - id: snapshot
        env:
          ALLOW_LARGE_REDUCTION: ${{ inputs.allow_large_reduction || false }}
        shell: bash
        run: |
          ARGS=(--output site --previous-base-url "https://0xfa7ca7.github.io/opsi/")
          if test "$ALLOW_LARGE_REDUCTION" = "true"; then
            ARGS+=(--allow-large-reduction)
          fi
          node packages/catalogue-snapshot/dist/publish-entry.js "${ARGS[@]}"
          node --input-type=module -e '
            import { readFileSync } from "node:fs";
            const value = JSON.parse(readFileSync("site/deployment.json", "utf8"));
            if (!/^[a-f0-9]{64}$/.test(value.sha256)) throw new Error("invalid deployment digest");
            if (Number.isNaN(Date.parse(value.generatedAt))) throw new Error("invalid generation timestamp");
            process.stdout.write(`sha256=${value.sha256}\ngenerated-at=${value.generatedAt}\n`);
          ' >> "$GITHUB_OUTPUT"
      - uses: actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b
      - uses: actions/upload-pages-artifact@7b1f4a764d45c48632c6b24a0339c27f5614fb0b
        with:
          path: site

  deploy:
    needs: generate
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    outputs:
      page-url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e

  verify:
    needs: [generate, deploy]
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5
        with:
          ref: ${{ github.event.repository.default_branch }}
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: 24
      - run: corepack enable && corepack prepare pnpm@11.11.0 --activate
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @opsi/catalogue-snapshot build
      - run: node packages/catalogue-snapshot/dist/verify-entry.js --base-url "${{ needs.deploy.outputs.page-url }}" --expected-sha256 "${{ needs.generate.outputs.sha256 }}" --expected-generated-at "${{ needs.generate.outputs.generated-at }}"
```

The output step parses `deployment.json` with Node, validates both values, and appends fixed key/value lines to `$GITHUB_OUTPUT`; it must not evaluate remote or generated text as shell code. Keep Pages write/OIDC permissions only on `deploy`.

- [ ] **Step 4: Add snapshot tests to normal CI**

The root recursive build/typecheck and existing unit/integration commands discover the package automatically. Add an explicit workflow syntax/contract step only if the normal unit project does not execute `workflow.test.ts`. Do not run live generation in PR CI.

- [ ] **Step 5: Document service operation**

Document endpoint paths, six-hour schedule, 24-hour client rejection, 48-hour immutable retention, manual large-reduction dispatch, first-time GitHub Pages enablement, failure investigation, local controlled-fixture generation, and public verification. Link the design document and GitHub's custom Pages workflow requirements.

- [ ] **Step 6: Run workflow and repository checks**

Run: `pnpm exec vitest run --project unit packages/catalogue-snapshot/test/workflow.test.ts`

Expected: PASS.

Run: `ruby -e 'require "yaml"; YAML.load_file(".github/workflows/catalogue-snapshot.yml", aliases: true); puts "valid"'`

Expected: `valid`.

- [ ] **Step 7: Commit workflow and operations documentation**

```bash
git add .github/workflows/catalogue-snapshot.yml .github/workflows/ci.yml docs/catalogue-service.md packages/catalogue-snapshot/test/workflow.test.ts
git commit -m "ci: publish catalogue snapshots every six hours"
```

---

### Task 6: Full regression, packaging, documentation, and live deployment proof

**Files:**
- Modify: `README.md`
- Modify: `docs/architecture.md`
- Modify: `docs/security.md`
- Modify: `docs/installation.md`
- Modify: `CHANGELOG.md`
- Modify: `apps/cli/test/pack.test.ts`
- Modify: `docs/superpowers/specs/2026-07-13-catalogue-snapshot-design.md` only if implementation revealed a verified contract correction.

**Interfaces:**
- Consumes: all completed snapshot package, CLI, and workflow behavior.
- Produces: release-safe package bytes, complete user/operator docs, and public service evidence.

- [ ] **Step 1: Add a failing pack assertion**

Extend `pack.test.ts` to install the exact tarball, assert `opsi dataset list --help` contains `--refresh` and `--live`, and inspect the tarball file list to prove no `latest.json`, `index.json`, snapshot payload, or `catalogue-snapshot` source package is shipped.

- [ ] **Step 2: Run pack test and verify the new assertion fails before the final build**

Run: `pnpm build && pnpm test:pack`

Expected: FAIL until CLI help/package assembly matches the final contract.

- [ ] **Step 3: Complete user, architecture, security, installation, and changelog documentation**

Document the fast default command, freshness guarantee, explicit live escape hatch, supported snapshot fields, offline behavior, static trust boundary, digest/schema/size controls, Pages availability dependency, and service operations link. Do not claim that GitHub Pages or GitHub Actions provides a hard uptime SLA.

- [ ] **Step 4: Run all local quality gates**

Run these commands separately and require exit code 0 from each:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm build
pnpm test:unit
OPSI_OFFLINE=1 pnpm test:integration
OPSI_OFFLINE=1 pnpm test:e2e
OPSI_OFFLINE=1 pnpm test:pack
```

Expected: all suites pass with no live OPSI or GitHub request from the test commands.

- [ ] **Step 5: Run controlled performance and failure smoke checks**

Using the integration fixture, measure a warm cached `dataset list --json` five times and assert each run completes under 250 ms. Verify a cold fixture makes one manifest and one snapshot request. Verify a hanging fixture exits within the ten-second network bound. Record exact timings in the PR description rather than committing generated timing files.

- [ ] **Step 6: Commit final regression and documentation changes**

```bash
git add README.md CHANGELOG.md docs apps/cli/test/pack.test.ts
git commit -m "docs: document the catalogue snapshot service"
```

- [ ] **Step 7: Push and open a draft pull request**

Push `codex/catalogue-snapshot-service`, open a draft PR against the repository default branch, and include design, test totals, security controls, Pages enablement requirement, and the fact that the scheduled workflow cannot publish until merged to the default branch.

- [ ] **Step 8: Verify the GitHub PR pipeline**

Wait for every required PR check. If any check fails, inspect its GitHub Actions log, reproduce locally where possible, fix test-first, recommit, push, and repeat until the PR pipeline is fully green.

- [ ] **Step 9: After merge, dispatch and verify the first public snapshot**

This step is intentionally post-merge because scheduled/Pages deployment uses the trusted default branch. Enable GitHub Pages with GitHub Actions as the source if repository settings do not already do so, manually dispatch `Catalogue snapshot`, and verify:

```bash
curl --fail --silent --show-error https://0xfa7ca7.github.io/opsi/v1/latest.json
opsi dataset list --refresh --json
opsi dataset list --offline --json
```

Expected: the workflow's generate, deploy, and verify jobs pass; both CLI invocations return the same count/digest-backed snapshot; JSON metadata reports `snapshot-remote` then `snapshot-cache`; `generatedAt` is younger than 24 hours.
