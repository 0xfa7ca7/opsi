# Configuration

Precedence is CLI flags, environment, `./opsi.config.json`, user config, then defaults. `opsi config path` prints both files. Defaults: provider `opsi`, output `human`, locale `sl-SI`, online mode, platform cache/data directories, HTTP timeout 30000 ms, download maximum 2 GiB, preview 20 rows, query 1000 rows/30000 ms, DuckDB `1GB` and 4 threads, a transparent 10 GB/30-day DuckDB stage cache, and color unless `NO_COLOR` exists.

Environment names include `OPSI_PROVIDER`, `OPSI_OUTPUT`, `OPSI_OFFLINE`, `OPSI_CACHE_DIR`, `OPSI_DOWNLOAD_DIR`, `OPSI_HTTP_TIMEOUT_MS`, `OPSI_MAX_DOWNLOAD_BYTES`, `OPSI_QUERY_ROW_LIMIT`, `OPSI_QUERY_TIMEOUT_MS`, `OPSI_DUCKDB_MEMORY_LIMIT`, `OPSI_DUCKDB_CACHE_ENABLED`, `OPSI_DUCKDB_CACHE_MAX_BYTES`, `OPSI_DUCKDB_CACHE_TTL_DAYS`, and `OPSI_API_KEY`. Only the environment may provide secrets. `config set` validates the complete strict schema and refuses api-key/token/secret/authorization/cookie-like keys.

## Complete schema

`provider` is a non-empty provider ID; `output` is `human|json|ndjson|csv|tsv`; `locale` is non-empty; and `offline` is boolean. Paths are non-empty and HTTP/preview/query limits are positive integers. DuckDB memory is bounded to exact `1GB`, threads to 1–4, and its cache uses validated byte sizes. Archive limits are `archive.maxEntries`, `maxPathBytes`, `maxSelectedBytes`, `maxExpandedBytes`, and `maxCompressionRatio`. XML limits are `xml.maxDocumentBytes`, `maxDepth`, `maxAttributesPerElement`, `maxValueBytes`, `maxColumns`, `maxRecords`, and `maxStateBytes`. All are positive. Unknown keys fail strict validation.

The defaults are provider `opsi`, human output, locale `sl-SI`, online mode, platform-conventional cache/data roots, 30,000 ms HTTP timeout, 2 GiB maximum download, 20 preview rows, 1,000 query rows, 30,000 ms query timeout, `1GB` DuckDB memory, four threads, `duckdb.cache = {"enabled":true,"maxBytes":"10GB","ttlDays":30}`, and color when `NO_COLOR` is absent. The DuckDB budget applies only to rebuildable derived stages; raw downloads, provider metadata, catalogue snapshots, and provenance are outside its LRU eviction budget.

Archive defaults are 10,000 entries, 1,024 path bytes, 512 MiB selected bytes, 1 GiB expanded bytes, and a 200:1 compression ratio. XML defaults are 64 MiB document/state, depth 128, 256 attributes per element, 1 MiB values, 1,024 columns, and 100,000 records.

## Examples and precedence

User file: `{"query":{"rowLimit":500},"terminal":{"color":false}}`. Project file: `{"provider":"opsi","offline":true}`. `OPSI_OFFLINE=0 opsi search promet --offline` is offline because the CLI layer wins. `OPSI_OUTPUT=csv opsi search promet --json` produces JSON for the same reason. Nested objects merge by field; later layers do not erase sibling fields.

Use `opsi config path` before editing by hand, `opsi config set query.rowLimit 500` for validated atomic writes, `opsi config get query.rowLimit`, and `opsi config list`. Values that parse as JSON retain boolean/number/object meaning; other values remain strings. The project file is never mutated by `config set`.

## Secrets and recovery

`OPSI_API_KEY` is read only from the process environment. Config commands neither display nor persist it. Secret-like dotted keys are rejected even if the schema would otherwise reject them later. Debug rendering redacts API keys, tokens, authorization, cookies, and secret assignments. If configuration is invalid, correct or remove the reported file/value; `config path` paths are documented by platform in installation guidance.
