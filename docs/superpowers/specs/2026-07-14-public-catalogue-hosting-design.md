# Public catalogue hosting design

## Context

The catalogue snapshot implementation is complete, but the source repository is private and
the current GitHub plan rejects GitHub Pages for private repositories. Making the source
repository public would expose more than the catalogue data and is not required.

## Architecture

Keep generation, validation, scheduling, and deployment control in the private `0xfa7ca7/opsi`
repository. Publish only the generated site beneath `klopsi/` in the separate public user-site
repository `0xfa7ca7/0xfa7ca7.github.io` on its `gh-pages` branch. GitHub Pages serves that tree at
the existing production URL, `https://0xfa7ca7.github.io/klopsi/`.

The private workflow authenticates to the public repository with an Ed25519 deploy key whose
write permission is scoped to `0xfa7ca7.github.io`. Its private half is stored as the
`CATALOGUE_DEPLOY_KEY` secret in the private source repository's `catalogue-production`
environment; that environment's deployment-branch policy permits only the trusted default
branch. The public half is registered only as a deploy key on the data repository. The workflow
does not use a personal access token, copy source code, expose the key in logs, or grant a
feature-ref dispatch access to the deployment credential.

## Publication flow

The existing scheduled workflow continues to run every six hours and may also be dispatched
manually. It builds the workspace dependency closure, traverses the live KLOPSI catalogue,
validates the candidate against the prior public snapshot, and stages the complete site. A
deployment job wraps the staged files beneath `klopsi/`, creates a single deterministic commit, and force-pushes it
to the data repository's `gh-pages` branch. The job then waits for Pages to serve the exact
generated digest and timestamp before succeeding.

The public repository contains generated catalogue artifacts only. Force-pushing bounds its Git
history while the site's existing 48-hour snapshot index preserves the immutable files required
by recently cached manifests. A failed generation or validation never changes the public branch.

## Client and freshness behavior

`DEFAULT_CATALOGUE_BASE_URL` remains
`https://0xfa7ca7.github.io/klopsi/`. The manifest and snapshot schemas, strict HTTPS
reader, integrity checks, 8.5-second shared read deadline, 24-hour maximum age, local content
cache, `--refresh`, and explicit `--live` escape hatch remain unchanged. A successful default
`klopsi dataset list` therefore requires at most two small public requests on a cold cache and no
network request while its validated cache remains fresh.

## Failure handling

Missing deployment credentials, a rejected push, an unhealthy Pages build, or a public digest
mismatch fails the workflow. Verification retries only to accommodate bounded Pages propagation;
it never accepts stale or mismatched content. Operators can regenerate from a trusted default
branch, rotate the repository-scoped deploy key independently, and inspect the public data
repository without access to the private source repository.

## Verification

Static workflow tests pin the public repository, branch, endpoint, secret name, and dependency
closure build in every relevant job. Unit and integration tests assert that the existing default endpoint remains stable.
End-to-end completion requires a green source CI run, a green catalogue publication run, a
public manifest younger than 24 hours whose referenced bytes match its SHA-256, and successful
local `klopsi dataset list --refresh` followed by an offline cached list.
