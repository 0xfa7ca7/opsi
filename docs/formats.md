# Format development

The registered handlers are resilient delimited text, JSON, NDJSON, XLSX, Parquet, generic XML records, and one supported entry from a ZIP archive. Detection combines signatures, media type, bounded content evidence, declarations, and extension. Handlers stream or enforce explicit bounds, normalize rows without executing formulas, clean temporary files, and preserve conversion provenance.

## Detection and common contract

Signature evidence wins, then trusted media type, bounded decoded content, declared format, and finally extension. Delimited text detects UTF-8/UTF-16LE/UTF-16BE and comma, tab, semicolon, or pipe dialects. ZIP inspection rejects traversal, links, encryption, nested archives, excessive expansion, and ambiguous selection; pass `--entry`. XML uses bounded SAX parsing, rejects DTD/entities, infers one repeated record path, and accepts `--record-path` when discovery is ambiguous. A preview returns bounded rows, columns, returned count, truncation, selection metadata, and warnings.

## Handler notes

Delimited text uses strict streaming parsing, headers, detected encoding/dialect, rectangular rows, and formula warnings. JSON accepts bounded arrays/objects; NDJSON requires independent records. XLSX streams worksheets and requires `--sheet` when ambiguous. Parquet verifies signatures and uses DuckDB without extension installation. XML rows flatten qualified leaf paths and attributes consistently for preview, schema, validation, conversion, and query.

Type inference distinguishes null, boolean, integer, number, date/datetime, and string conservatively; mixed/unsafe values fall back to string. Columns and cell/output bytes are bounded. Empty/malformed inputs return stable invalid/validation errors. Query and conversion staging creates an OPSI-owned `data` table using quoted paths; no user SQL participates in import statements.

## Adding a format

Add it to `SUPPORTED_DATA_FORMATS`, extension/media/signature detection, preview and validation dispatch, conversion source/destination rules if supported, doctor fixture creation and real preview, CLI choices, completion, command docs, and security analysis. Tests need valid, malformed, oversized/boundary, cancellation/cleanup, schema, and round-trip fixtures. If a native package is necessary, keep catalogue startup safe, define supported platform lanes, make failure typed/remediable, and compile omitted-optional SDK consumers.
