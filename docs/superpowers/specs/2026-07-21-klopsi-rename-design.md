# KLopsi Clean-Slate Rename Design

**Date:** 2026-07-21
**Status:** Approved, amended after the repository rename

## Context

The first npm release is still unpublished. npm rejected the unscoped package name `opsi` as too similar to existing packages. The available unscoped name `klopsi` preserves a short installation experience and gives the project a distinct identity. Because no version has shipped, the rename does not need compatibility aliases or migrations.

## Decision

Rename every project-owned identity from OPSI to KLopsi before publishing `0.0.1`:

- npm package `klopsi`
- CLI executable `klopsi`
- SDK entry point `klopsi/sdk`
- public TypeScript symbols such as `KlopsiClient`
- workspace package scope `@klopsi/*`
- product environment variables, configuration directories, cache paths, generated skills, tests, documentation, and release automation
- product-facing prose and examples

Do not ship an `opsi` command, npm package alias, public import alias, or filesystem migration. The project is unreleased, so a single canonical product name is safer and clearer. The `opsi` identifier remains valid for the Slovenian government catalogue integration.

## External identifiers

Project-owned identifiers use KLopsi. The external Slovenian open-data catalogue is named OPSI, so the integration retains that identity:

- repository metadata and links use the renamed `0xfa7ca7/klopsi` repository
- the first-party adapter is `@klopsi/provider-opsi`, implemented by `OpsiProvider` and `OpsiTransport`
- the provider descriptor ID and canonical references use `opsi`, such as `opsi:resource:<id>`
- provider-specific settings use `OPSI_BASE_URL`, `OPSI_API_KEY`, and `OPSI_REQUEST_INTERVAL_MS`
- OPSI fixtures, documentation, upstream URLs, payload fields, and other service literals retain the external name
- Git history is immutable and out of scope

The repository rename is complete; package metadata, trusted-publisher instructions, badges, skill-install URLs, and local remotes now use `0xfa7ca7/klopsi`.

## Implementation boundaries

The rename includes source paths and filenames where they encode project identity, package manifests and lockfiles, workspace imports, public declarations, CLI help and diagnostics, generated Agent Skills, workflows, and current documentation. Provider paths and fixtures use OPSI because they model that external service.

Provider code uses the OPSI service name while depending on KLopsi-owned domain contracts and errors. Tests distinguish product identity from the external provider identity instead of banning OPSI references globally.

## Release behavior

The release workflow publishes `klopsi@0.0.1` from the canonical tarball produced by tag CI. It checks the embedded package name, registry absence, integrity, installation, executable version, and provenance using `klopsi`. The annotated `v0.0.1` tag is retargeted only after the rename PR merges and the registry still proves the version is absent.

After the bootstrap publish succeeds, configure npm trusted publishing for `klopsi` using `.github/workflows/release.yml` and the protected `npm` environment, then delete and revoke the bootstrap token.

## Verification

Add a failing rename contract before implementation. The contract must assert the npm package, executable, SDK entry point, workspace scope, release target, user-facing installation commands, canonical repository URL, and OPSI provider surface. A repository scan rejects former KLopsi-as-provider identifiers while allowing the intentional OPSI adapter, provider IDs, canonical references, settings, fixtures, and prose.

Run the focused rename contract, formatting, lint, typecheck, build, all unit/integration/CLI E2E tests, canonical package tests, and a local install/import smoke of the generated tarball. GitHub CI must pass on Linux, macOS, and Windows before merge.

## Failure handling

If npm rejects `klopsi` before accepting the version, preserve the failed workflow and registry evidence and do not publish locally. If npm accepts the version, never retarget the tag or reuse the version; finish recovery using the immutable published artifact and a follow-up version when required.
