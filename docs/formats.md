# Format development

The registered handlers are CSV, TSV, JSON, NDJSON, XLSX, and Parquet. Detection combines extension, media type, and content evidence. Handlers must stream or enforce explicit bounds, normalize rows without executing formulas, support deterministic schema/validation results, clean temporary files, and preserve provenance through conversion. XLSX handling must bound shared strings and worksheet selection; Parquet/JSON native paths use DuckDB with extension loading disabled. Add unit, malformed-input, size-bound, and conversion round-trip fixtures for every handler change.
