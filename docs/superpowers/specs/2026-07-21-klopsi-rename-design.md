# KLopsi Clean-Slate Rename Design

**Date:** 2026-07-21
**Status:** Approved

## Context

The first npm release is still unpublished. npm rejected the unscoped package name `opsi` as too similar to existing packages. The available unscoped name `klopsi` preserves a short installation experience and gives the project a distinct identity. Because no version has shipped, the rename does not need compatibility aliases or migrations.

## Decision

Rename every project-owned identity from OPSI to KLopsi before publishing `0.0.1`:

- npm package `klopsi`
- CLI executable `klopsi`
- SDK entry point `klopsi/sdk`
- public TypeScript symbols such as `KlopsiClient`
- workspace package scope `@klopsi/*`
- environment variables, configuration directories, cache paths, generated skills, fixtures, tests, documentation, and release automation
- product-facing prose and examples

Do not ship an `opsi` command, package alias, import alias, environment-variable alias, or filesystem migration. The project is unreleased, so a single canonical name is safer and clearer.

## External identifiers

Project-owned identifiers must use KLopsi. Identifiers controlled by external systems remain unchanged only where changing them would break integration:

- the existing GitHub repository path `0xfa7ca7/opsi` remains until the repository is renamed separately
- upstream URLs, payload fields, and other literals required by Slovenia's public-data services remain exact
- Git history is immutable and out of scope

The implementation will create a GitHub backlog issue for renaming the repository to `klopsi` and updating external links after that external change.

## Implementation boundaries

The rename includes source paths and filenames where they encode project identity, package manifests and lockfiles, workspace imports, public declarations, CLI help and diagnostics, generated Agent Skills, test fixtures, workflows, and current documentation. Historical design and plan documents are updated when they describe the current product or commands; factual records of past repository paths may retain the old external URL until the repository rename.

Provider code may use the KLopsi product name while preserving any upstream wire values that the remote service requires. Tests must distinguish intentional upstream or repository-path literals from accidental project-brand remnants.

## Release behavior

The release workflow publishes `klopsi@0.0.1` from the canonical tarball produced by tag CI. It checks the embedded package name, registry absence, integrity, installation, executable version, and provenance using `klopsi`. The annotated `v0.0.1` tag is retargeted only after the rename PR merges and the registry still proves the version is absent.

After the bootstrap publish succeeds, configure npm trusted publishing for `klopsi` using `.github/workflows/release.yml` and the protected `npm` environment, then delete and revoke the bootstrap token.

## Verification

Add a failing rename contract before implementation. The contract must assert the new npm package, executable, SDK entry point, workspace scope, release target, and user-facing installation commands. A repository scan must reject project-owned `opsi` references while allowing only reviewed external repository or upstream-service literals.

Run the focused rename contract, formatting, lint, typecheck, build, all unit/integration/CLI E2E tests, canonical package tests, and a local install/import smoke of the generated tarball. GitHub CI must pass on Linux, macOS, and Windows before merge.

## Failure handling

If npm rejects `klopsi` before accepting the version, preserve the failed workflow and registry evidence and do not publish locally. If npm accepts the version, never retarget the tag or reuse the version; finish recovery using the immutable published artifact and a follow-up version when required.
