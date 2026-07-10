// ExcelJS is CommonJS; its interop is intentionally isolated in this adapter.
import type ExcelJS from "exceljs";
import { createRequire } from "node:module";
import { EXIT_CODES, OpsiError } from "@opsi/domain";
import { recordsToRows } from "./csv.js";
import type { DataRow, ValidationIssue } from "./types.js";

const readerOptions = {
  sharedStrings: "cache" as const,
  hyperlinks: "ignore" as const,
  styles: "ignore" as const,
  worksheets: "emit" as const,
};

interface ZipEntry {
  readonly path: string;
  readonly uncompressedSize: number;
  stream(): NodeJS.ReadableStream;
}

interface ZipDirectory {
  readonly files: readonly ZipEntry[];
}

interface UnzipperInterop {
  readonly Open: { file(path: string): Promise<ZipDirectory> };
}

interface WorkbookReaderInternals {
  _parseRels(stream: NodeJS.ReadableStream): Promise<void>;
  _parseWorkbook(stream: NodeJS.ReadableStream): Promise<void>;
  _parseSharedStrings(stream: NodeJS.ReadableStream): AsyncGenerator<unknown>;
}

type NamedWorksheetReader = ExcelJS.stream.xlsx.WorksheetReader & { readonly name: string };

const localRequire = createRequire(import.meta.url);
let excelJsPromise: Promise<typeof ExcelJS> | undefined;

function loadExcelJs(): Promise<typeof ExcelJS> {
  excelJsPromise ??= import("exceljs").then((module) => module.default);
  return excelJsPromise;
}

async function streamingReader(
  path: string,
  sharedStringsByteLimit: number,
): Promise<ExcelJS.stream.xlsx.WorkbookReader> {
  const excelJs = await loadExcelJs();
  const reader = new excelJs.stream.xlsx.WorkbookReader(path, readerOptions);
  // ExcelJS 4 can encounter worksheets before workbook.xml in a valid ZIP and
  // dereference an unset model. Preloading only the workbook metadata keeps row
  // processing streaming while making entry ordering deterministic.
  const excelRequire = createRequire(localRequire.resolve("exceljs/package.json"));
  const unzipper = excelRequire("unzipper") as UnzipperInterop;
  const directory = await unzipper.Open.file(path);
  const entry = (name: string): ZipEntry | undefined =>
    directory.files.find((candidate) => candidate.path === name);
  const relationships = entry("xl/_rels/workbook.xml.rels");
  const workbook = entry("xl/workbook.xml");
  const sharedStrings = entry("xl/sharedStrings.xml");
  if (sharedStrings !== undefined && sharedStrings.uncompressedSize > sharedStringsByteLimit)
    throw new OpsiError({
      code: "XLSX_SHARED_STRINGS_TOO_LARGE",
      message: "The XLSX shared-string table exceeds the bounded preview limit.",
      exitCode: EXIT_CODES.UNSUPPORTED,
      suggestion: "Convert the workbook to CSV or Parquet before previewing it.",
      context: { bytes: sharedStrings.uncompressedSize, limit: sharedStringsByteLimit },
    });
  const internal = reader as unknown as WorkbookReaderInternals;
  if (relationships !== undefined) await internal._parseRels(relationships.stream());
  if (workbook !== undefined) await internal._parseWorkbook(workbook.stream());
  if (sharedStrings !== undefined)
    for await (const _value of internal._parseSharedStrings(sharedStrings.stream())) {
      void _value;
      // Cache shared strings without retaining worksheet rows.
    }
  return reader;
}

export async function listSheets(
  path: string,
  sharedStringsByteLimit: number,
): Promise<readonly string[]> {
  const workbook = await streamingReader(path, sharedStringsByteLimit);
  const sheets: string[] = [];
  for await (const rawWorksheet of workbook) {
    const worksheet = rawWorksheet as NamedWorksheetReader;
    sheets.push(worksheet.name);
    for await (const _row of worksheet) {
      void _row;
      // Consume the streaming worksheet without retaining data.
    }
  }
  return sheets;
}

function cellValue(cell: ExcelJS.Cell, warnings: ValidationIssue[], row: number): unknown {
  if (cell.formula !== undefined) {
    warnings.push({
      code: "FORMULA_CELL",
      severity: "warning",
      message:
        "The workbook contains a formula cell; its formula was preserved without evaluation.",
      recommendation:
        "Review the formula in a trusted spreadsheet application if its result is needed.",
      row,
      column: cell.fullAddress.col,
    });
    return `=${cell.formula}`;
  }
  const value = cell.value;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null) {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("richText" in value && Array.isArray(value.richText))
      return value.richText.map((part) => part.text).join("");
    if ("error" in value) return String(value.error);
  }
  return value ?? null;
}

export async function previewXlsx(
  path: string,
  sheet: string | undefined,
  limit: number,
  sharedStringsByteLimit: number,
): Promise<{
  readonly rows: readonly DataRow[];
  readonly columns: readonly string[];
  readonly truncated: boolean;
  readonly sheet: string;
  readonly warnings: readonly ValidationIssue[];
}> {
  if (sheet === undefined || sheet.trim().length === 0) {
    const sheets = await listSheets(path, sharedStringsByteLimit);
    throw new OpsiError({
      code: "SHEET_REQUIRED",
      message: "XLSX preview requires an explicit sheet selection.",
      exitCode: EXIT_CODES.INVALID_INPUT,
      suggestion: `Use --sheet with one of: ${sheets.join(", ")}.`,
      context: { sheets },
    });
  }
  const workbook = await streamingReader(path, sharedStringsByteLimit);
  const records: unknown[][] = [];
  const warnings: ValidationIssue[] = [];
  let found = false;
  for await (const rawWorksheet of workbook) {
    const worksheet = rawWorksheet as NamedWorksheetReader;
    if (worksheet.name !== sheet) {
      for await (const _row of worksheet) {
        void _row;
        // Consume to advance to the requested sheet.
      }
      continue;
    }
    found = true;
    for await (const row of worksheet) {
      const values: unknown[] = [];
      for (let column = 1; column <= row.cellCount; column += 1)
        values.push(cellValue(row.getCell(column), warnings, row.number));
      records.push(values);
      if (records.length >= limit + 2) break;
    }
    break;
  }
  if (!found)
    throw new OpsiError({
      code: "SHEET_NOT_FOUND",
      message: `XLSX sheet '${sheet}' was not found.`,
      exitCode: EXIT_CODES.NOT_FOUND,
      context: { sheet },
    });
  const columns = (records[0] ?? []).map((value, index) =>
    value === null || value === "" ? `column_${index + 1}` : String(value),
  );
  const data = records.slice(1);
  return {
    columns,
    rows: recordsToRows(columns, data.slice(0, limit)),
    truncated: data.length > limit,
    sheet,
    warnings,
  };
}
