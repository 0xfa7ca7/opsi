# Releases

Changesets define version/release notes. CI performs a frozen install, all quality and offline test gates, builds once, creates one canonical npm tarball, records its SHA-256, and installs those exact bytes on Linux x64 glibc, macOS arm64, and Windows x64. The current-Node lane is advisory.

Release tags must equal `v<package version>` and use the protected `npm` environment. The release workflow downloads—not rebuilds—the tested artifact, verifies tag/version/digest and package absence, upgrades npm to at least 11.5.1, publishes with npm trusted publishing/OIDC and provenance, installs the published exact version, verifies npm provenance, and attaches the tarball/checksum to GitHub. No stored npm token is permitted. Never publish from an untested local build.
