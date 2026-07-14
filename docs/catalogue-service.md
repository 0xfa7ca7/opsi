# Catalogue snapshot service

The catalogue snapshot service publishes the compact, versioned catalogue used by normal
`opsi dataset list` calls. Its architecture and trust boundaries are defined in the
[catalogue snapshot design](superpowers/specs/2026-07-13-catalogue-snapshot-design.md) and
[public hosting design](superpowers/specs/2026-07-14-public-catalogue-hosting-design.md).

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

## Public hosting and deploy key

Generation, validation, scheduling, and deployment control remain in the private
`0xfa7ca7/opsi` repository. The workflow publishes only generated files to the public,
data-only user-site repository `0xfa7ca7/0xfa7ca7.github.io`: its `gh-pages` branch contains
the complete site beneath `opsi/`, which GitHub Pages serves at
`https://0xfa7ca7.github.io/opsi/`. Do not copy the source checkout, a personal access token,
or any long-lived credential into the public repository.

Provision `0xfa7ca7/0xfa7ca7.github.io` as a **public** repository dedicated to generated data.
Do not initialize it from the private source repository or add application source, workflow
files, repository secrets, or a reusable credential. The publishing workflow creates and then
replaces its `gh-pages` branch; `main` is not a publication source.

Create the repository-scoped deployment credential from a trusted machine:

```sh
umask 077
ssh-keygen -t ed25519 -C "opsi catalogue publisher" -N "" -f ./catalogue-deploy-key
```

Add `catalogue-deploy-key.pub` in the public repository under **Settings → Deploy keys → Add
deploy key**, select **Allow write access**, and add the private file as the repository Actions
secret `CATALOGUE_DEPLOY_KEY` in the private `0xfa7ca7/opsi` repository. Delete both local files
after the secret is set. The public half must be registered only on `0xfa7ca7.github.io`; the
private half must exist only in the private repository secret and must never appear in logs.
See GitHub's [deploy-key guidance](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys)
and [Actions secret guidance](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-secrets-in-github-actions).

To rotate the credential, generate a new pair, add the new public half as a second write-enabled
deploy key, replace `CATALOGUE_DEPLOY_KEY` with the new private half, and run the workflow
manually. Remove the old public deploy key only after `generate`, `deploy`, and `verify` succeed,
then securely delete the replacement private file from the trusted machine.

## Enable branch-based GitHub Pages

The private workflow uses the deploy key to force-push the generated `opsi/` tree to the public
repository's `gh-pages` branch; it does not use GitHub Pages OIDC or a Pages deployment action.
After the first push creates that branch, open the public repository's **Settings → Pages**, set
**Source** to **Deploy from a branch**, select `gh-pages` and `/(root)`, and save. GitHub documents
the branch and root-folder choices in
[Configuring a publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site).

The first run may complete `deploy` but fail `verify` while Pages is not yet configured. After
enabling Pages, rerun **Actions → Catalogue snapshot → Run workflow** from the private
repository's trusted default branch. A successful run must complete `generate`, `deploy`, and
`verify`.

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
  change the public `gh-pages` branch.
- `deploy`: confirm `CATALOGUE_DEPLOY_KEY` is present in the private repository, its public half
  remains a write-enabled deploy key on `0xfa7ca7.github.io`, and branch rules do not reject the
  force-push. A missing or malformed key and a rejected SSH push fail the job. Do not replace the
  repository-scoped key with a personal access token or broaden workflow permissions.
- `verify`: open the deployment URL and inspect `v1/latest.json` plus its referenced immutable
  snapshot. After the push, the workflow runs the strict verifier up to 12 times at 10-second
  intervals to allow bounded Pages propagation. It succeeds only when the public digest and
  generation timestamp exactly match that run; exhausted retries, an unhealthy publication, or
  any mismatch fail the workflow.

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
snapshot pass schema, byte-count, SHA-256, timestamp, and expected-deployment checks. Complete
end-to-end verification with a refreshed client read followed by a cached offline read:

```sh
opsi dataset list --refresh --json
opsi --offline dataset list --json
```
