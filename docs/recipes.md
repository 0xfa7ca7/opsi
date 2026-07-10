# Recipes

Search and inspect: `opsi search promet --json --limit 5`, then `opsi dataset show ID --json` and `opsi dataset resources ID`.

Download and reuse offline: `opsi download opsi:resource:ID --output ./downloads`, then set `OPSI_OFFLINE=1` or use `--offline` for cached catalogue work.

Inspect and validate: `opsi resource preview ./downloads/data.csv --limit 10 --json`; `opsi validate ./downloads/data.csv --json`.

Query and export: `opsi query ./downloads/data.csv --sql "select * from data limit 10" --output result.json --json`.

Convert and verify: `opsi convert data.csv --to parquet --output data.parquet`; `opsi provenance show data.parquet`; `opsi provenance verify data.parquet --json`.
