# Catalogue snapshot service

The catalogue snapshot service publishes the compact, versioned catalogue used by normal
`opsi dataset list` calls. Its architecture and trust boundaries are defined in the
[catalogue snapshot design](superpowers/specs/2026-07-13-catalogue-snapshot-design.md).

## Public endpoints and freshness

The production base URL is `https://0xfa7ca7.github.io/opsi/`. Version 1 publishes:

- `v1/latest.json`: the current manifest consumed by clients;
- `v1/snapshots/{generatedAt}.json`: immutable catalogue bytes referenced by a manifest, with
  timestamp colons replaced by hyphens (for example,
  `v1/snapshots/2026-07-13T12-00-00.000Z.json`);
- `v1/index.json`: the publisher's retention index; clients do not consume it;
- `deployment.json`: the digest and generation timestamp used by deployment verification.

The scheduled workflow starts at minute 17 every six hours (UTC). Clients reject a snapshot
once its `generatedAt` is more than 24 hours old; retrieval or cache time never extends that
window. Each deployment carries forward valid immutable snapshots generated within the
previous 48 hours. The 48-hour retention window prevents a cached prior manifest from pointing
at an artifact removed by a newer deployment, but retention beyond that window is not
guaranteed.

## Enable GitHub Pages

Before the first run, a repository administrator must open **Settings → Pages** and select
**GitHub Actions** as the build and deployment source. GitHub documents this setup in
[Using custom workflows with GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
The workflow deploys through the `github-pages` environment. Keep `pages: write` and
`id-token: write` confined to its `deploy` job; the generation and verification jobs need only
`contents: read`.

Run **Actions → Catalogue snapshot → Run workflow** once after enablement. A successful run
must complete `generate`, `deploy`, and `verify`; confirm that `v1/latest.json` is reachable at
the production base URL.

## Scheduled and manual operation

Routine publication is automatic. Concurrency is serialized without cancelling an in-progress
deployment, and every run checks out the repository's trusted default branch. Pull-request CI
runs the static workflow contract and controlled fixtures, but never performs live catalogue
generation or a Pages deployment.

The publisher rejects a candidate whose dataset count is more than 10 percent below the
previous catalogue. Investigate the live OPSI catalogue and the failed run before overriding
this guard. If the reduction is intentional, dispatch **Catalogue snapshot** manually from the
default branch and select **Allow publishing a catalogue reduction greater than 10 percent**.
Never use the override merely to bypass a timeout, partial traversal, malformed response, or
unexplained count change.

## Investigate failures

Start with the failed job in the workflow run:

- `generate`: inspect dependency/build errors, live OPSI traversal failures, invalid retained
  index or snapshot errors, and `CATALOGUE_COUNT_REDUCTION`. A failed generation does not
  replace the current Pages site.
- `deploy`: confirm Pages still uses GitHub Actions, the `github-pages` environment permits the
  run, and the deploy job still has its Pages and OIDC permissions. Do not grant these write
  permissions to the other jobs.
- `verify`: open the deployment URL and inspect `v1/latest.json` plus its referenced immutable
  snapshot. A digest or timestamp mismatch means the public deployment is not the artifact
  produced by that run.

Check the manifest's `generatedAt` whenever failures repeat. Resolve and rerun before the
published snapshot crosses the 24-hour client limit. Preserve the failed run logs; do not
assemble or deploy unverified site bytes by hand.

## Local controlled-fixture generation

Build the package and run the publisher integration test:

```sh
pnpm --filter @opsi/catalogue-snapshot build
pnpm exec vitest run --project integration packages/catalogue-snapshot/test/publisher.integration.test.ts
```

This test generates and verifies complete site artifacts against controlled local HTTP fixtures.
It does not contact OPSI or GitHub Pages. The production publisher entry point performs a live
catalogue traversal, so reserve it for the scheduled or explicitly approved manual workflow.

## Verify the public deployment

The workflow passes the exact digest and generation timestamp emitted by `generate` into the
post-deployment verifier. To repeat that check locally, copy those expected values from the run,
then execute:

```sh
pnpm --filter @opsi/catalogue-snapshot build
EXPECTED_SHA256=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
EXPECTED_GENERATED_AT=2026-07-13T12:00:00.000Z
node packages/catalogue-snapshot/dist/verify-entry.js \
  --base-url "https://0xfa7ca7.github.io/opsi/" \
  --expected-sha256 "$EXPECTED_SHA256" \
  --expected-generated-at "$EXPECTED_GENERATED_AT"
```

Replace both example values; verification fails unless the public manifest and immutable
snapshot pass schema, byte-count, SHA-256, timestamp, and expected-deployment checks.
