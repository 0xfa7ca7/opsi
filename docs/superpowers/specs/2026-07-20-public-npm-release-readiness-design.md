# Public npm Release Readiness Design

## Decision

Publish the public `klopsi` package from the public `0xfa7ca7/opsi` GitHub repository through the existing tag-triggered GitHub Actions workflow. Keep npm trusted publishing, the protected `npm` environment, exact tested-tarball verification, and provenance. Do not add an npm token or a local publishing path.

## Repository identity

The public package metadata and packaged documentation must identify `https://github.com/0xfa7ca7/opsi`. npm trusted publishing validates this repository identity against the GitHub OIDC claims. The Changesets base branch is `main`.

## Public-source documentation

User-facing architecture and catalogue operations documentation must describe `0xfa7ca7/opsi` as the public source repository. The separate `0xfa7ca7/0xfa7ca7.github.io` repository remains a generated-data-only deployment target, and its deploy key remains stored as a protected environment secret. Historical design and implementation-plan records remain unchanged because they document the earlier private-source decision.

## Verification

Automated metadata tests enforce the canonical GitHub repository and Changesets base branch. `pnpm changeset status` must resolve against `main`, and `pnpm check` must pass before a release tag is created.

## External setup

After repository visibility becomes public, create the `npm` GitHub environment, protect tags matching `v*`, sign in to the npm CLI with two-factor authentication, and authorize `.github/workflows/release.yml` as the trusted publisher for package `klopsi`. These account-level operations are intentionally separate from source changes.
