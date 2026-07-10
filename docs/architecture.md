# Architecture

The pnpm monorepo separates domain types and ports, core application services and `OpsiClient`, provider adapters, configuration, secure storage/download/provenance, format/query engine, rendering, and the Commander adapter. The CLI is bundled into the public npm artifact while DuckDB and streaming parsers remain normal/optional runtime packages. `command-manifest.ts` is the normalized command/completion source; command modules adapt arguments to `OpsiClient`. `opsi/sdk` exports only the client and public domain types, never private workspace specifiers.

Extensions implement `DataProvider` using provider-neutral branded IDs, canonical references, capabilities, and resolved-resource classification. New formats belong behind the data-engine contract and must support bounded detection, preview, validation, conversion, and tests where applicable.
