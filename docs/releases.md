# Releases

Changesets define version/release notes. CI performs a frozen install, all quality and offline test gates, builds once, creates one canonical npm tarball, records its SHA-256, and installs those exact bytes on Linux x64 glibc, macOS arm64, and Windows x64. The current-Node lane is advisory.

Release tags must equal `v<package version>` and use the protected `npm` environment. The release workflow downloads—not rebuilds—the tested artifact, verifies tag/version/digest and package absence, upgrades npm to at least 11.5.1, publishes with npm trusted publishing/OIDC and provenance, installs the published exact version, verifies npm provenance, and attaches the tarball/checksum to GitHub. No stored npm token is permitted. Never publish from an untested local build.

## CI production of canonical bytes

The quality job begins from a checkout with all `dist` directories removed, performs frozen install, formatting, lint, strict typecheck, ordinary offline unit/integration/E2E/security tests, builds, then runs the canonical pack gate. `pack.test.ts` checks the exact allowlist and tar-embedded metadata/shebang/modes/specifiers/secrets/paths; clean-installs and smokes Node/DuckDB/XLSX/SDK; compiles a strict TypeScript consumer normally and with omitted optionals; and verifies typed native absence.

CI then creates one named tarball, `pack.json`, and `SHA256SUMS`. Exact-install jobs download those bytes and assert Linux/x64/glibc, macOS/arm64, or Windows/x64 before install/query/doctor/SDK smoke. The current-Node lane is advisory. No platform job repacks.

## Tag and publish binding

Push `v<version>` only after the same commit's tag-triggered CI succeeds. The protected `npm` environment gates the publish job. It verifies `GITHUB_REF_TYPE=tag`, checkout tag commit equals `GITHUB_SHA`, and locates a successful CI `push` run whose head SHA and head branch/tag equal the release event. The artifact checksum, tar-embedded name/version, and tag are checked before registry access. Existing versions abort.

npm is upgraded to at least 11.5.1 and publishes the downloaded tarball using trusted publishing (`id-token: write`) with provenance and no `NODE_AUTH_TOKEN` secret. Afterward, registry `dist.integrity` must equal the canonical SHA-512 SRI; `npm pack opsi@version` must have the same SHA-256 bytes; exact install/version and signature audit must pass. Build provenance is attested.

## GitHub Release and recovery

A separate least-privilege job with `contents: write` downloads the same in-run release artifact, rechecks `SHA256SUMS`, verifies the existing tag and target commit, creates the GitHub Release, and attaches the canonical `.tgz` plus `SHA256SUMS` without rebuilding. The publish job retains `contents: read` and OIDC permission.

If any binding, digest, registry, provenance, install, or asset step fails, do not republish or recreate bytes locally. Preserve logs/artifacts, fix source/workflow under a new version/Changeset, rerun CI, and create a new tag. npm versions are immutable; never reuse a failed/partial published version.
