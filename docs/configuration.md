# Configuration

Precedence is CLI flags, environment, `./opsi.config.json`, user config, then defaults. `opsi config path` prints both files. Defaults: provider `opsi`, output `human`, locale `sl-SI`, online mode, platform cache/data directories, HTTP timeout 30000 ms, download maximum 2 GiB, preview 20 rows, query 1000 rows/30000 ms, DuckDB `1GB` and 4 threads, and color unless `NO_COLOR` exists.

Environment names include `OPSI_PROVIDER`, `OPSI_OUTPUT`, `OPSI_OFFLINE`, `OPSI_CACHE_DIR`, `OPSI_DOWNLOAD_DIR`, `OPSI_HTTP_TIMEOUT_MS`, `OPSI_MAX_DOWNLOAD_BYTES`, `OPSI_QUERY_ROW_LIMIT`, `OPSI_QUERY_TIMEOUT_MS`, `OPSI_DUCKDB_MEMORY_LIMIT`, and `OPSI_API_KEY`. Only the environment may provide secrets. `config set` validates the complete strict schema and refuses api-key/token/secret/authorization/cookie-like keys.

## Complete schema

`provider` is a non-empty provider ID; `output` is `human|json|ndjson|csv|tsv`; `locale` is a non-empty locale; and `offline` is boolean. `paths.cacheDir` and `paths.downloadDir` are non-empty paths. `http.timeoutMs`, `http.maxDownloadBytes`, `preview.rowLimit`, `query.rowLimit`, and `query.timeoutMs` are positive integers. `duckdb.memoryLimit` is a supported positive byte size no larger than exact `1GB`; `duckdb.threads` is 1–4. `terminal.color` is boolean. Unknown keys fail strict validation instead of being ignored.

The defaults are provider `opsi`, human output, locale `sl-SI`, online mode, platform-conventional cache/data roots, 30,000 ms HTTP timeout, 2 GiB maximum download, 20 preview rows, 1,000 query rows, 30,000 ms query timeout, `1GB` DuckDB memory, four threads, and color when `NO_COLOR` is absent.

## Examples and precedence

User file: `{"query":{"rowLimit":500},"terminal":{"color":false}}`. Project file: `{"provider":"opsi","offline":true}`. `OPSI_OFFLINE=0 opsi search promet --offline` is offline because the CLI layer wins. `OPSI_OUTPUT=csv opsi search promet --json` produces JSON for the same reason. Nested objects merge by field; later layers do not erase sibling fields.

Use `opsi config path` before editing by hand, `opsi config set query.rowLimit 500` for validated atomic writes, `opsi config get query.rowLimit`, and `opsi config list`. Values that parse as JSON retain boolean/number/object meaning; other values remain strings. The project file is never mutated by `config set`.

## Secrets and recovery

`OPSI_API_KEY` is read only from the process environment. Config commands neither display nor persist it. Secret-like dotted keys are rejected even if the schema would otherwise reject them later. Debug rendering redacts API keys, tokens, authorization, cookies, and secret assignments. If configuration is invalid, correct or remove the reported file/value; `config path` paths are documented by platform in installation guidance.
