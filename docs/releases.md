# Releases

Changesets define version/release notes. CI performs a frozen install, all quality and offline test gates, creates one canonical npm tarball, records its SHA-256, and installs those exact bytes on Linux x64 glibc, macOS arm64, and Windows x64. The current-Node lane is advisory.

Release tags must equal `v<package version>` and use the protected `npm` environment. The release workflow downloads—not rebuilds—the tested artifact, verifies tag/version/digest and package absence, upgrades npm to at least 11.5.1, publishes with provenance, installs the published exact version, verifies npm provenance, and attaches the tarball/checksum to GitHub. `0.0.1` uses the one-time bootstrap token described below; every later version requires npm trusted publishing/OIDC and rejects a remaining token. Never publish from an untested local build.

## First public release: 0.0.1

The repository is still unreleased; the first public npm and GitHub release is `klopsi@0.0.1` from tag `v0.0.1`. npm requires a package to exist before a trusted publisher can be configured, so this first version is the only token-authenticated release. Create a short-lived granular npm token that can publish new public packages and bypasses 2FA for automation, then store it as the `NPM_TOKEN` secret in the protected GitHub `npm` environment. Do not place it in a repository secret or local file.

```sh
gh secret set NPM_TOKEN --env npm --repo 0xfa7ca7/opsi
```

Before creating the tag, confirm that the repository is public, the protected GitHub `npm` environment exists, and its custom deployment policy allows tags matching `v*` (policy type `tag`, not `branch`).

Run the complete local gate and confirm that the immutable version is still absent from npm:

```sh
pnpm check
npm view klopsi@0.0.1 version
```

The npm lookup must return `E404`. After the release commit is merged and its branch CI is green, create and push the annotated release tag:

```sh
git tag -a v0.0.1 -m "klopsi 0.0.1"
git push origin v0.0.1
```

The tag starts both CI and the release workflow. The release job waits for the successful tag CI run, downloads those exact canonical bytes, and publishes them with provenance. Never run `npm publish` locally; if the workflow fails before publishing, fix the source and retry only as permitted by the recovery rules below.

After `klopsi@0.0.1` is verified on npm, configure the trusted publisher while signed in to npm with 2FA, then immediately delete the bootstrap secret:

```sh
npm trust github klopsi --repo 0xfa7ca7/opsi --file release.yml --env npm --allow-publish
gh secret delete NPM_TOKEN --env npm --repo 0xfa7ca7/opsi
```

The workflow enforces this transition: `0.0.1` requires the secret, while every later version fails before publish if the secret still exists. Subsequent releases authenticate only through the `release.yml` OIDC trust relationship.

## CI production of canonical bytes

The quality job begins from a checkout with all `dist` directories removed, then performs frozen install, formatting, lint, strict typecheck, a clean build, ordinary offline unit/integration/E2E/security tests, and the canonical pack gate in that order. `pack.test.ts` checks the exact allowlist and tar-embedded metadata/shebang/modes/specifiers/secrets/paths; clean-installs and smokes Node/DuckDB/XLSX/SDK; compiles a strict TypeScript consumer normally and with omitted optionals; and verifies typed native absence.

CI then creates one named tarball, `pack.json`, and `SHA256SUMS`. Exact-install jobs download those bytes and assert Linux/x64/glibc, macOS/arm64, or Windows/x64 before install/query/doctor/SDK smoke. The current-Node lane is advisory. No platform job repacks.

## Tag and publish binding

Push `v<version>` only after the same commit's tag-triggered CI succeeds. GitHub enforces the `Protect release tags` ruleset when the tag is written; the workflow does not introspect that control-plane configuration at runtime. The protected `npm` environment gates the publish job. It verifies `GITHUB_REF_TYPE=tag`, checkout tag commit equals `GITHUB_SHA`, and locates a successful CI `push` run whose head SHA and head branch/tag equal the release event. The artifact checksum, tar-embedded name/version, and tag are checked before registry access. Existing versions abort.

npm is upgraded to at least 11.5.1 and publishes the downloaded tarball with provenance. Version `0.0.1` receives `NODE_AUTH_TOKEN` from the protected environment for the registry bootstrap; later releases require that secret to be absent and use trusted publishing (`id-token: write`). Afterward, registry `dist.integrity` must equal the canonical SHA-512 SRI; `npm pack klopsi@version` must have the same SHA-256 bytes; exact install/version and signature audit must pass. Build provenance is attested.

## GitHub Release and recovery

A separate least-privilege job with `contents: write` downloads the same in-run release artifact, rechecks `SHA256SUMS`, verifies the existing tag and target commit, creates the GitHub Release, and attaches the canonical `.tgz` plus `SHA256SUMS` without rebuilding. The publish job retains `contents: read` and OIDC permission.

If the workflow fails before registry publication, first prove that npm still returns `E404` for the version and no GitHub Release exists. Preserve the failed run, fix the source or workflow through protected `main`, rerun every gate, and retarget the annotated tag to the corrected commit through the audited administrator bypass. This recovery is allowed only while both public artifacts are absent.

If publication may have started, or any registry, provenance, install, or asset step fails after npm accepts the version, do not republish, retarget the tag, or recreate bytes locally. Preserve logs and artifacts, fix the source or workflow under a new version and Changeset, rerun CI, and create a new tag. npm versions are immutable; never reuse a failed or partially published version.
