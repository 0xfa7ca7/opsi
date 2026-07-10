# Format development

The registered handlers are CSV, TSV, JSON, NDJSON, XLSX, and Parquet. Detection combines extension, media type, and content evidence. Handlers must stream or enforce explicit bounds, normalize rows without executing formulas, support deterministic schema/validation results, clean temporary files, and preserve provenance through conversion. XLSX handling must bound shared strings and worksheet selection; Parquet/JSON native paths use DuckDB with extension loading disabled. Add unit, malformed-input, size-bound, and conversion round-trip fixtures for every handler change.

## Detection and common contract

Signature evidence wins, then trusted media type, bounded UTF-8 content, declared format, and finally extension. ZIP is not automatically extracted; only an XLSX signature with workbook entries becomes XLSX. Detection returns format, confidence, path, and available declaration evidence. A handler preview returns bounded rows, columns, returned count, truncation, optional sheet, and warnings. Validation returns deterministic issues with severity/code/location/recommendation. Conversion writes a temporary artifact, validates/flushes it, atomically publishes, and writes provenance.

## Handler notes

CSV and TSV use strict streaming parsing, headers, delimiter-specific behavior, rectangular rows, and explicit formula warnings. JSON accepts bounded arrays/objects through native/DuckDB paths; NDJSON requires independent JSON records and reports the failing record. XLSX streams worksheets, requires `--sheet` when selection is ambiguous, bounds shared strings and columns, treats formulas as data rather than executable code, and supports spreadsheet-safe export. Parquet verifies header/footer signatures and uses DuckDB's built-in reader without downloading/installing extensions.

Type inference distinguishes null, boolean, integer, number, date/datetime, and string conservatively; mixed/unsafe values fall back to string. Columns and cell/output bytes are bounded. Empty/malformed inputs return stable invalid/validation errors. Query and conversion staging creates an OPSI-owned `data` table using quoted paths; no user SQL participates in import statements.

## Adding a format

Add it to `SUPPORTED_DATA_FORMATS`, extension/media/signature detection, preview and validation dispatch, conversion source/destination rules if supported, doctor fixture creation and real preview, CLI choices, completion, command docs, and security analysis. Tests need valid, malformed, oversized/boundary, cancellation/cleanup, schema, and round-trip fixtures. If a native package is necessary, keep catalogue startup safe, define supported platform lanes, make failure typed/remediable, and compile omitted-optional SDK consumers.
