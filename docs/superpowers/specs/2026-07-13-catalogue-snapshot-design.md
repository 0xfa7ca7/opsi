# Catalogue Snapshot Service Design

## Objective

Make `opsi dataset list` a fast, deterministic catalogue operation for agents without sending every CLI installation through OPSI's slow, full-metadata pagination. Normal listing must use a reusable compact snapshot that is never more than 24 hours old. Direct live traversal remains available only when explicitly requested.

## Context

OPSI currently contains 8,967 datasets. The live `package_search` gateway ignores field projection and returns complete dataset and resource metadata even when the caller needs only `id`, `title`, and `name`. A 300-record response measured approximately 15.1 MB and four seconds, implying roughly 451 MB across the catalogue. The provider also spaces request starts by seven seconds. A reliable full traversal therefore takes several minutes. A previous 1,000-record page size was reverted because it was unreliable.

The catalogue snapshot moves that expensive traversal into one centrally scheduled job. Clients download only a compact, validated static artifact and reuse it locally for up to 24 hours.

## Scope

This work includes:

- a scheduled GitHub Actions snapshot generator and static publisher;
- a versioned manifest and compact dataset snapshot format;
- secure snapshot retrieval, validation, and atomic local caching;
- fast snapshot-backed `opsi dataset list` behavior;
- explicit `--refresh` and `--live` modes;
- offline and stale-data behavior;
- unit, integration, E2E, workflow, and deployment smoke coverage;
- command, architecture, security, and operator documentation.

This work does not add a dynamic application server, silently launch background refreshes, change `opsi search`, or include a snapshot in the npm package.

## Architecture

### Snapshot publisher

A dedicated GitHub Actions workflow in this repository runs every six hours and through `workflow_dispatch`. It is separate from the pull-request quality pipeline and publishes a static catalogue through GitHub Pages. Running four times per day provides multiple retry opportunities before the 24-hour freshness boundary.

The generator uses the same OPSI provider contracts and mapping code as the CLI. It traverses the live gateway serially with the proven 300-record page size, projects each record to `id`, `title`, and `name`, sorts deterministically by `name` and then `id` using Unicode code-unit comparison, and validates the complete collection before publishing. This ordering is independent of the process locale.

Each successful run publishes:

- an immutable snapshot at `v1/snapshots/{generatedAt}.json`;
- a mutable `v1/latest.json` manifest pointing to that immutable snapshot;
- a mutable `v1/index.json` retention index listing immutable snapshots from the previous 48 hours;
- deployment metadata needed for a post-publication smoke check.

The Pages deployment retains immutable snapshots for at least 48 hours before pruning them. This exceeds the 24-hour client freshness window and prevents a CDN-cached prior manifest from becoming a broken pointer during deployment. Retention beyond 48 hours is not part of the CLI contract.

### Snapshot manifest

`v1/latest.json` has this strict schema:

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-07-13T12:00:00.000Z",
  "snapshotPath": "v1/snapshots/2026-07-13T12-00-00.000Z.json",
  "count": 8967,
  "bytes": 1234567,
  "sha256": "64-lowercase-hex-characters"
}
```

`snapshotPath` is relative and must remain under `v1/snapshots/`; absolute URLs, traversal segments, query strings, and fragments are rejected. `generatedAt` is the authoritative freshness timestamp. Download time never extends freshness.

### Snapshot data

The immutable snapshot has this strict schema:

```json
{
  "schemaVersion": "1",
  "generatedAt": "2026-07-13T12:00:00.000Z",
  "count": 8967,
  "datasets": [
    {
      "id": "a5c74601-49fa-4cf8-a660-0d82b05c9cb5",
      "title": "Turistične informacije v Občini Trzin",
      "name": "07_obcina_trzin_turisticne_informacije"
    }
  ]
}
```

The publisher and CLI require:

- exact schema version `1`;
- a valid UTC `generatedAt` matching the manifest;
- `count` equal to the dataset array length and manifest count;
- non-empty `id`, `title`, and `name` strings;
- unique dataset IDs;
- deterministic, locale-independent Unicode code-unit `name`, then `id` order;
- actual bytes and SHA-256 matching the manifest;
- a configured maximum manifest and snapshot size.

Before publication, the workflow compares the candidate count with the previously published manifest. A large unexpected count reduction fails publication rather than replacing a good snapshot. The exact safety threshold is configurable in the generator and covered by tests; the initial default is a 10% reduction. A manual dispatch may explicitly approve a larger reduction after operator investigation.

## CLI behavior

### Default mode

`opsi dataset list` performs these steps:

1. Acquire the catalogue snapshot cache lock.
2. Read and validate the local compact snapshot.
3. If its `generatedAt` is no more than 24 hours old, release the lock and render it.
4. Otherwise fetch the fixed HTTPS `latest.json` endpoint with a short timeout.
5. Validate manifest freshness and construct the snapshot URL from its safe relative path.
6. Download the snapshot to a temporary file with strict redirect, timeout, and byte limits.
7. Verify size, digest, schema, timestamps, count, uniqueness, and ordering before producing output.
8. Atomically publish the validated snapshot and manifest into the metadata cache.
9. Release the lock and render the snapshot.

Immediately before the manifest fetch, the client starts one monotonic 8.5-second remote-operation
budget. The manifest consumes part of that budget and the snapshot receives only the remaining
time. The strict reader still caps every individual request at its configured per-request ceiling,
which defaults to 9.5 seconds, so a shorter explicit reader timeout remains effective. If no
operation time remains, the client fails before starting another request. This leaves 1.5 seconds
of headroom for typed error propagation and cleanup within the under-ten-second observable bound.

No records are emitted before complete validation, so an integrity failure cannot produce trusted-looking partial output. Concurrent invocations share the cache lock; after the first process publishes, waiting processes reuse that snapshot instead of downloading it again.

The default mode never falls back to direct OPSI pagination. This prevents an agent command from unexpectedly changing from seconds to minutes.

### `--refresh`

`opsi dataset list --refresh` ignores a fresh local snapshot and fetches the current published manifest and snapshot. It still enforces the 24-hour freshness requirement and does not contact OPSI directly. It conflicts with `--offline` and may reuse an unchanged cached snapshot when the remote manifest digest is identical.

### `--live`

`opsi dataset list --live` explicitly uses the existing advancing 300-record OPSI pagination. It retains streaming behavior for human, NDJSON, CSV, and TSV output and buffering for JSON. It conflicts with `--refresh` and `--offline`.

### Fields and formats

Snapshot mode supports `id`, `title`, and `name`. They remain the default field order. Requesting any other field without `--live` fails immediately with an invalid-input error that recommends `--live`; the CLI never silently selects the slow path.

All existing output formats remain available. Snapshot data is fully validated before table, NDJSON, CSV, TSV, or JSON rendering begins. JSON metadata contains:

- `total` and `count`;
- `source`: `snapshot-cache`, `snapshot-remote`, or `live`;
- `generatedAt` for snapshot modes;
- `stale: false` for accepted snapshots;
- `pages` only for live pagination.

### Offline mode

`OPSI_OFFLINE=1 opsi dataset list` succeeds only when a locally cached snapshot is valid and no more than 24 hours old. Missing, invalid, or stale cache data fails quickly. No release-bundled or arbitrarily stale fallback exists.

## Freshness and failure policy

A snapshot is accepted only when the local clock is not more than 24 hours after `generatedAt`. A small forward-clock tolerance handles normal clock skew, but it never extends the 24-hour maximum age. The service runs every six hours so a single delayed or failed workflow does not immediately affect clients.

Failures are typed and actionable:

- `CATALOGUE_SNAPSHOT_UNAVAILABLE`: the manifest/snapshot operation exhausted its shared deadline or a read failed;
- `CATALOGUE_SNAPSHOT_STALE`: `generatedAt` is more than 24 hours old;
- `CATALOGUE_SNAPSHOT_INVALID`: schema, count, ordering, URL, size, or timestamp validation failed;
- `CATALOGUE_SNAPSHOT_INTEGRITY`: byte length or SHA-256 did not match the manifest;
- existing provider errors remain in use for `--live` failures.

Snapshot retrieval failures exit with provider/network category 4. Unsupported snapshot fields and conflicting options exit with invalid-input category 2. Error suggestions direct users to retry, inspect service status, or explicitly use `--live` when current OPSI access is acceptable.

The CLI does not accept a stale snapshot on network failure and does not start a background process. This makes freshness, latency, and network behavior deterministic for agents.

## Security

The implementation applies these controls:

- one compile-time HTTPS manifest origin;
- safe resolution of a relative snapshot path under the expected versioned prefix;
- redirect validation and rejection of HTTPS downgrade, credentials, fragments, private addresses, and unexpected origins;
- one shared manifest/snapshot operation deadline plus per-request timeout ceilings;
- strict manifest and snapshot byte caps;
- strict runtime schemas with unknown-field rejection;
- SHA-256 and exact byte-length verification before cache publication;
- atomic file publication and the existing cache locking model;
- terminal sanitation through the existing renderer;
- no API key in snapshot URLs, cache metadata, logs, or artifacts;
- minimum GitHub workflow permissions (`contents: read` and `pages: read` for generation, Pages/OIDC writes only for deployment, and `contents: read` for verification);
- third-party GitHub Actions pinned to immutable commit SHAs;
- deterministic generator dependencies installed from the lockfile;
- post-deployment retrieval and validation from the public endpoint.

The snapshot contains public identifiers and titles only. It contains no credentials, resource URLs, personal contact metadata, or arbitrary provider metadata.

## GitHub workflow

The scheduled workflow has two jobs:

1. `generate-and-deploy`
   - check out the trusted default branch;
   - install the pinned Node and pnpm toolchain from the lockfile;
   - run the snapshot generator against OPSI;
   - validate the candidate and prior-count guard;
   - assemble the Pages artifact;
   - deploy with GitHub's OIDC-backed Pages action.
2. `verify-publication`
   - retrieve `latest.json` from the public Pages URL with cache busting;
   - retrieve the referenced immutable snapshot;
   - run the same validation used by the CLI;
   - fail if the public result is not the just-generated digest or timestamp.

The workflow uses `concurrency` to prevent overlapping publications. Failed generation never replaces the current Pages deployment. GitHub Actions failure notifications provide the initial operational alert; the public verification job makes deployment or CDN failures visible in the same run.

Before assembling a new Pages artifact, the workflow retrieves and validates the currently published retention index and every referenced snapshot generated within the previous 48 hours. It carries those valid immutable snapshots forward, adds the new snapshot, writes a new index and latest manifest, and then atomically deploys the complete site artifact. A `404` retention index is treated as the first publication. Any other retrieval failure or invalid prior index/snapshot aborts publication so a partial deployment cannot break retained immutable URLs. The CLI does not consume the retention index.

## Testing

### Generator tests

- projection to exactly `id`, `title`, and `name`;
- deterministic ordering;
- digest and byte-count generation;
- duplicate IDs and malformed records;
- count mismatch and prior-count reduction guard;
- deterministic output from controlled provider pages;
- invalid or non-advancing live pagination.

### Snapshot client tests

- fresh local cache performs no network call;
- cold cache retrieves and atomically stores one snapshot;
- `--refresh` bypasses freshness but handles an unchanged digest;
- stale remote and stale offline cache fail;
- malformed manifest, unsafe path, redirect, oversized body, digest mismatch, count mismatch, timestamp mismatch, duplicate IDs, and incorrect ordering fail;
- concurrent refreshes coalesce through the cache lock;
- a delayed manifest followed by a hanging snapshot fails within the shared observable bound;
- no failure path invokes live OPSI pagination.

### CLI tests

- default `id`, `title`, `name` output in table, JSON, NDJSON, CSV, and TSV;
- supported field reordering;
- unsupported snapshot field remediation;
- option conflicts and offline behavior;
- snapshot source and freshness metadata;
- explicit `--live` retains current pagination and streaming tests;
- structured errors and exit categories.

All automated tests use controlled fixtures. Normal tests never contact OPSI or GitHub Pages. The scheduled workflow performs the bounded live generation and public smoke test.

## Performance acceptance criteria

- A warm-cache `dataset list` completes locally in under 250 ms in the performance fixture.
- A cold invocation makes at most one manifest and one snapshot request.
- Snapshot networking shares one 8.5-second manifest/snapshot operation budget; the strict reader's 9.5-second default remains a per-request ceiling, and observable failure remains under ten seconds.
- The compact snapshot remains below the configured maximum size.
- Normal `dataset list` never calls OPSI directly.
- No accepted snapshot is more than 24 hours old according to `generatedAt`.
- Live traversal remains available only through `--live`.

## Documentation and compatibility

The command reference documents snapshot-backed defaults, supported fields, freshness, `--refresh`, `--live`, and failure behavior. Architecture and security documentation describe the external static service and trust boundary. The public snapshot schema is versioned so future fields or formats can be introduced at a new path without changing version 1 consumers.

The command keeps its existing name, default fields, output formats, and exit categories. The intentional compatibility changes are that normal listing requires a fresh snapshot service/cache and arbitrary projected fields require explicit `--live`.
