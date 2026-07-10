# Configuration

Precedence is CLI flags, environment, `./opsi.config.json`, user config, then defaults. `opsi config path` prints both files. Defaults: provider `opsi`, output `human`, locale `sl-SI`, online mode, platform cache/data directories, HTTP timeout 30000 ms, download maximum 2 GiB, preview 20 rows, query 1000 rows/30000 ms, DuckDB `1GB` and 4 threads, and color unless `NO_COLOR` exists.

Environment names include `OPSI_PROVIDER`, `OPSI_OUTPUT`, `OPSI_OFFLINE`, `OPSI_CACHE_DIR`, `OPSI_DOWNLOAD_DIR`, `OPSI_HTTP_TIMEOUT_MS`, `OPSI_MAX_DOWNLOAD_BYTES`, `OPSI_QUERY_ROW_LIMIT`, `OPSI_QUERY_TIMEOUT_MS`, `OPSI_DUCKDB_MEMORY_LIMIT`, and `OPSI_API_KEY`. Only the environment may provide secrets. `config set` validates the complete strict schema and refuses api-key/token/secret/authorization/cookie-like keys.
