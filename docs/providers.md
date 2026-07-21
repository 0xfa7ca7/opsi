# Provider development

A provider supplies a stable descriptor and implements search, dataset/resource lookup, dataset resources, and resource resolution as declared capabilities. Map remote values to domain entities, preserve unknown upstream metadata under `providerMetadata.raw`, emit canonical references, validate every response, and map authentication, network, rate-limit, not-found, and unsupported failures to stable `KlopsiError` values. Tests must use stored or local controlled fixtures and cover malformed legacy responses; normal tests may not contact OPSI.

## Contract

`descriptor` contains a branded provider ID, display name, capabilities, and optional description/homepage. `search(SearchQuery)` returns a bounded `SearchPage`; `getDataset(DatasetId)` and `getResource(ResourceId)` return normalized entities; `listDatasetResources` preserves dataset membership; `resolveResource(Resource)` classifies the target as file, page, API, archive, or service and supplies a fetch URL plus optional filename/format/media type. Unsupported capabilities return exit 5, never silent partial objects.

Canonical references are `<provider>:dataset:<id>` and `<provider>:resource:<id>`. Known-noun commands may accept bare IDs. Providers must not interpret a local file reference. Every URL remains untrusted until the storage/download layer validates scheme, DNS results, redirect targets, time, and size; provider resolution must not bypass that layer.

## OPSI adapter

The first-party adapter targets the configurable legacy CKAN-compatible gateway. It validates operation input/output with strict known fields plus preserved unknown metadata, maps irregular null/string/number values, uses a keyed scheduler to coalesce/retry allowed reads, and caches normalized metadata. Offline mode reads cache only and returns `OFFLINE_CACHE_MISS` without attempting transport. The public page opener does not trust provider URLs: it derives a fixed HTTPS podatki.gov.si origin from the validated dataset slug.

## Local provider

The registered `local` provider declares only local resource resolution. It resolves ordinary paths relative to the invocation directory and absolute `local:file:` references without network access. Search and catalogue lookups are intentionally unsupported and return `PROVIDER_CAPABILITY_UNSUPPORTED`; `klopsi doctor` skips connectivity when local is selected.

## Adding a provider

Implement the domain interface, add descriptor/capability tests, register it at the composition root, expose any non-secret configuration, and add controlled contract fixtures for success, not found, malformed envelope, authentication/rate limiting, and offline cache behavior. Search sorting/filtering must reject unsupported fields rather than forwarding arbitrary provider syntax. Never put API keys in canonical references, cache keys, errors, provenance URLs, or test snapshots.

Provider development is complete only after `providers list`, catalogue commands, canonical download/preview resolution, structured errors, docs, lint/typecheck, and all offline tests pass. Live smoke tests, if added, must remain opt-in and aggressively bounded/rate-limited.
