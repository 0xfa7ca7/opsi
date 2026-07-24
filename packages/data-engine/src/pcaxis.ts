import { createReadStream } from "node:fs";
import { open, rm, stat, type FileHandle } from "node:fs/promises";
import { EXIT_CODES, KlopsiError } from "@klopsi/domain";
import type { DataRow, ValidationIssue } from "./types.js";

export interface PcAxisLimits {
  readonly maxSourceBytes: number;
  readonly maxMetadataBytes: number;
  readonly maxMetadataStatements: number;
  readonly maxStatementBytes: number;
  readonly maxDimensions: number;
  readonly maxValuesPerDimension: number;
  readonly maxCells: number;
  readonly maxDecodedStringBytes: number;
  readonly maxNotes: number;
  readonly maxLanguageVariants: number;
  readonly maxCellTokenBytes: number;
  readonly maxEmittedRecords: number;
  readonly maxStagingBytes: number;
}

export interface PxDimension {
  readonly name: string;
  readonly role: "stub" | "heading";
  readonly values: readonly string[];
  readonly codes?: readonly string[];
}

export interface PxMetadataVariant {
  readonly keyword: string;
  readonly language: string;
  readonly subkeys: readonly string[];
  readonly values: readonly string[];
}

export interface PxNote {
  readonly keyword: string;
  readonly language?: string;
  readonly subkeys: readonly string[];
  readonly values: readonly string[];
}

export interface PcAxisMetadata {
  readonly encoding: "windows-1250" | "utf-8";
  readonly dimensions: readonly PxDimension[];
  readonly decimals?: number;
  readonly unit?: string;
  readonly matrix: string;
  readonly title?: string;
  readonly contents?: string;
  readonly source?: string;
  readonly database?: string;
  readonly dataSymbols: Readonly<Record<string, string>>;
  readonly notes: readonly PxNote[];
  readonly languageVariants: readonly PxMetadataVariant[];
  readonly expectedCellCount: number;
  readonly dataOffset: number;
}

export interface PcAxisPreview {
  readonly format: "pcaxis";
  readonly columns: readonly string[];
  readonly codeColumns: readonly string[];
  readonly rows: readonly DataRow[];
  readonly returnedCount: number;
  readonly truncated: boolean;
  readonly warnings: readonly ValidationIssue[];
  readonly encoding: "windows-1250" | "utf-8";
}

export const DEFAULT_PCAXIS_LIMITS: PcAxisLimits = {
  maxSourceBytes: 512 * 1024 * 1024,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxMetadataStatements: 100_000,
  maxStatementBytes: 4 * 1024 * 1024,
  maxDimensions: 64,
  maxValuesPerDimension: 1_000_000,
  maxCells: 100_000_000,
  maxDecodedStringBytes: 1024 * 1024,
  maxNotes: 10_000,
  maxLanguageVariants: 10_000,
  maxCellTokenBytes: 64 * 1024,
  maxEmittedRecords: 1_000_000,
  maxStagingBytes: 1024 * 1024 * 1024,
};

interface MetadataPrefix {
  readonly bytes: Buffer;
  readonly dataOffset: number;
}

interface PxAssignment {
  readonly keyword: string;
  readonly language?: string;
  readonly subkeys: readonly string[];
  readonly values: readonly string[];
}

interface ColumnBinding {
  readonly label: string;
  readonly code?: string;
}

interface CellToken {
  readonly value: string;
  readonly quoted: boolean;
}

interface ParsedCell {
  readonly value: number | null;
  readonly symbol?: string;
}

const NOTE_KEYWORDS = new Set([
  "CELLNOTE",
  "CELLNOTEX",
  "DATANOTE",
  "DATANOTECELL",
  "DATANOTESUM",
  "NOTE",
  "NOTEX",
  "VALUENOTE",
  "VALUENOTEX",
]);
const REPEATABLE_KEYWORDS = NOTE_KEYWORDS;
const DATA_SYMBOLS = ["-", ".", "..", "...", "....", ".....", "......"] as const;
const NUMBER_TOKEN = /^[+-]?(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[Ee][+-]?\d+)?$/u;

function invalidPcAxis(
  message: string,
  context?: Readonly<Record<string, unknown>>,
  cause?: unknown,
): KlopsiError {
  return new KlopsiError({
    code: "INVALID_PCAXIS_DATA",
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    suggestion: "Use a valid dense PC-Axis file with bounded metadata and DATA tokens.",
    ...(context === undefined ? {} : { context }),
    ...(cause === undefined ? {} : { cause }),
  });
}

function dimensionLimit(message: string, context: Readonly<Record<string, unknown>>): KlopsiError {
  return new KlopsiError({
    code: "PCAXIS_DIMENSION_LIMIT",
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    context,
  });
}

function cellLimit(message: string, context: Readonly<Record<string, unknown>>): KlopsiError {
  return new KlopsiError({
    code: "PCAXIS_CELL_LIMIT",
    message,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    context,
  });
}

function cellCountMismatch(expected: number, actual: number): KlopsiError {
  return new KlopsiError({
    code: "PCAXIS_CELL_COUNT_MISMATCH",
    message: `The dense PC-Axis DATA section has ${actual} cells; ${expected} were expected.`,
    exitCode: EXIT_CODES.INTEGRITY_FAILURE,
    context: { expected, actual },
  });
}

function unsupportedEncoding(codepage: string | null): KlopsiError {
  return new KlopsiError({
    code: "PCAXIS_ENCODING_UNSUPPORTED",
    message:
      codepage === null
        ? "The PC-Axis file does not declare a supported CODEPAGE."
        : `The PC-Axis CODEPAGE "${codepage}" is not supported.`,
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: 'Use a PC-Axis file declaring CODEPAGE="windows-1250" or CODEPAGE="utf-8".',
    context: { codepage },
  });
}

function keysUnsupported(): KlopsiError {
  return new KlopsiError({
    code: "PCAXIS_KEYS_UNSUPPORTED",
    message: "Sparse or keyed PC-Axis DATA is not supported.",
    exitCode: EXIT_CODES.UNSUPPORTED,
    suggestion: "Export the source as a dense PX file without a KEYS assignment.",
  });
}

function normalizePcAxisError(error: unknown): KlopsiError {
  return error instanceof KlopsiError
    ? error
    : invalidPcAxis("The PC-Axis document is malformed or cannot be decoded.", undefined, error);
}

function assertLimits(limits: PcAxisLimits): void {
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value <= 0)
      throw invalidPcAxis("PC-Axis parser limits must be positive safe integers.", {
        limit: name,
        value,
      });
  }
}

function keywordFromLeft(left: string): string | undefined {
  return /^\s*([A-Za-z][A-Za-z0-9_-]*)/u.exec(left)?.[1]?.toUpperCase();
}

async function readMetadataPrefix(path: string, limits: PcAxisLimits): Promise<MetadataPrefix> {
  const information = await stat(path);
  if (information.size > limits.maxSourceBytes)
    throw invalidPcAxis("The PC-Axis source exceeds the configured source byte limit.", {
      limit: limits.maxSourceBytes,
      actual: information.size,
    });

  const handle = await open(path, "r");
  const chunks: Buffer[] = [];
  const buffer = Buffer.allocUnsafe(Math.min(16 * 1024, limits.maxMetadataBytes + 1));
  let position = 0;
  let statementStart = 0;
  let statementBytes = 0;
  let left = "";
  let hasEquals = false;
  let inQuotes = false;
  try {
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(chunk);
      for (let index = 0; index < chunk.length; index += 1) {
        const byte = chunk[index];
        if (byte === undefined) continue;
        const absolute = position + index;
        if (absolute + 1 > limits.maxMetadataBytes)
          throw invalidPcAxis("PC-Axis metadata exceeds the configured byte limit.", {
            limit: limits.maxMetadataBytes,
          });
        statementBytes += 1;
        if (statementBytes > limits.maxStatementBytes)
          throw invalidPcAxis("A PC-Axis metadata statement exceeds the configured byte limit.", {
            limit: limits.maxStatementBytes,
          });

        if (byte === 0x22) {
          inQuotes = !inQuotes;
          if (!hasEquals) left += '"';
          continue;
        }
        if (!inQuotes && byte === 0x3d) {
          if (hasEquals)
            throw invalidPcAxis("A PC-Axis metadata statement contains more than one assignment.");
          const keyword = keywordFromLeft(left);
          if (keyword === "KEYS") throw keysUnsupported();
          if (keyword === "DATA") {
            if (left.trim().toUpperCase() !== "DATA")
              throw invalidPcAxis("The DATA assignment cannot have a language or subkey.");
            const collected = Buffer.concat(chunks);
            return {
              bytes: Buffer.from(collected.subarray(0, statementStart)),
              dataOffset: absolute + 1,
            };
          }
          hasEquals = true;
          continue;
        }
        if (!inQuotes && byte === 0x3b) {
          if (!hasEquals)
            throw invalidPcAxis("A PC-Axis metadata statement is missing an equals sign.");
          statementStart = absolute + 1;
          statementBytes = 0;
          left = "";
          hasEquals = false;
          continue;
        }
        if (!hasEquals) left += String.fromCharCode(byte);
      }
      position += bytesRead;
    }
    if (inQuotes)
      throw invalidPcAxis("A PC-Axis metadata string has an unterminated quotation mark.");
    throw invalidPcAxis("The mandatory DATA assignment is missing.");
  } finally {
    await handle.close();
  }
}

function stripBom(text: string): string {
  return text.replace(/^(?:\uFEFF|\u00ef\u00bb\u00bf)/u, "");
}

function* metadataStatements(text: string, limits: PcAxisLimits): Generator<string> {
  let current = "";
  let inQuotes = false;
  let count = 0;
  for (const character of stripBom(text)) {
    if (character === '"') inQuotes = !inQuotes;
    if (character === ";" && !inQuotes) {
      if (current.trim().length === 0)
        throw invalidPcAxis("The PC-Axis metadata contains an empty statement.");
      count += 1;
      if (count > limits.maxMetadataStatements)
        throw invalidPcAxis("PC-Axis metadata exceeds the configured statement count limit.", {
          limit: limits.maxMetadataStatements,
        });
      yield current;
      current = "";
    } else current += character;
  }
  if (inQuotes)
    throw invalidPcAxis("A PC-Axis metadata string has an unterminated quotation mark.");
  if (current.trim().length > 0)
    throw invalidPcAxis("A PC-Axis metadata statement is missing its terminating semicolon.");
}

function assignmentEquals(statement: string): number {
  let inQuotes = false;
  for (let index = 0; index < statement.length; index += 1) {
    const character = statement[index];
    if (character === '"') inQuotes = !inQuotes;
    else if (character === "=" && !inQuotes) return index;
  }
  return -1;
}

function chargeString(value: string, limits: PcAxisLimits, enforce: boolean): void {
  if (enforce && Buffer.byteLength(value, "utf8") > limits.maxDecodedStringBytes)
    throw invalidPcAxis("A decoded PC-Axis metadata string exceeds the configured byte limit.", {
      limit: limits.maxDecodedStringBytes,
    });
}

function parseList(text: string, limits: PcAxisLimits, enforce: boolean): readonly string[] {
  const values: string[] = [];
  const quotedValues: boolean[] = [];
  let index = 0;
  let requireValue = true;
  while (index < text.length) {
    while (index < text.length && /\s/u.test(text[index] ?? "")) index += 1;
    if (index >= text.length) {
      if (requireValue && values.length > 0)
        throw invalidPcAxis("A PC-Axis value list has a trailing comma.");
      break;
    }

    let value = "";
    if (text[index] === '"') {
      quotedValues.push(true);
      index += 1;
      let closed = false;
      while (index < text.length) {
        const character = text[index];
        if (character === '"') {
          if (text[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += character;
        index += 1;
      }
      if (!closed) throw invalidPcAxis("A quoted PC-Axis value is unterminated.");
      while (index < text.length && /\s/u.test(text[index] ?? "")) index += 1;
      if (index < text.length && text[index] !== ",")
        throw invalidPcAxis("Unexpected text follows a quoted PC-Axis value.");
    } else {
      quotedValues.push(false);
      const start = index;
      while (index < text.length && text[index] !== ",") {
        if (text[index] === '"')
          throw invalidPcAxis("A quotation mark appears inside an unquoted PC-Axis value.");
        index += 1;
      }
      value = text.slice(start, index).trim();
      if (value.length === 0) throw invalidPcAxis("A PC-Axis value list contains an empty value.");
    }
    chargeString(value, limits, enforce);
    values.push(value);
    requireValue = false;
    if (text[index] === ",") {
      index += 1;
      requireValue = true;
    }
  }
  if (values.length === 0) throw invalidPcAxis("A PC-Axis assignment has no value.");
  if (values.length > 1 && quotedValues.some((quoted) => !quoted))
    throw invalidPcAxis("Every item in a multi-value PC-Axis list must be quoted.");
  return values;
}

function parseTimevalValues(
  text: string,
  limits: PcAxisLimits,
  enforce: boolean,
): readonly string[] {
  const expanded = /^(TLIST\(\s*[AHQMWD]1\s*\))\s*,([\s\S]+)$/iu.exec(text.trim());
  if (expanded !== null) {
    const directive = expanded[1] as string;
    chargeString(directive, limits, enforce);
    return [directive, ...parseList(expanded[2] as string, limits, enforce)];
  }

  const compact = /^(TLIST\(\s*[AHQMWD]1\s*,\s*"(?:[^"]|"")*"\s*-\s*"(?:[^"]|"")*"\s*\))$/iu.exec(
    text.trim(),
  );
  if (compact !== null) {
    const directive = compact[1] as string;
    chargeString(directive, limits, enforce);
    return [directive];
  }

  throw invalidPcAxis("TIMEVAL must use a valid TLIST assignment.");
}

function parseAssignment(statement: string, limits: PcAxisLimits, enforce: boolean): PxAssignment {
  const equals = assignmentEquals(statement);
  if (equals < 0) throw invalidPcAxis("A PC-Axis metadata statement is missing an equals sign.");
  const left = statement.slice(0, equals).trim();
  const right = statement.slice(equals + 1);
  const match = /^([A-Za-z][A-Za-z0-9_-]*)(?:\[([^\]\r\n]+)\])?(?:\(([\s\S]*)\))?$/u.exec(left);
  if (match === null) throw invalidPcAxis("A PC-Axis assignment has an invalid keyword form.");
  const keyword = (match[1] as string).toUpperCase();
  let language = match[2]?.trim();
  if (language?.startsWith('"') === true && language.endsWith('"'))
    language = parseList(language, limits, enforce)[0];
  if (language !== undefined) {
    if (language.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(language))
      throw invalidPcAxis("A PC-Axis language qualifier is invalid.");
    chargeString(language, limits, enforce);
  }
  const subkeys = match[3] === undefined ? [] : [...parseList(match[3], limits, enforce)];
  const values = [
    ...(keyword === "TIMEVAL"
      ? parseTimevalValues(right, limits, enforce)
      : parseList(right, limits, enforce)),
  ];
  return {
    keyword,
    ...(language === undefined ? {} : { language }),
    subkeys,
    values,
  };
}

function assignmentId(assignment: PxAssignment): string {
  return [assignment.keyword, assignment.language ?? "", JSON.stringify(assignment.subkeys)].join(
    "\u0000",
  );
}

function parseAssignments(
  text: string,
  limits: PcAxisLimits,
  enforce: boolean,
): readonly PxAssignment[] {
  const assignments: PxAssignment[] = [];
  const seen = new Set<string>();
  let notes = 0;
  let languageVariants = 0;
  for (const statement of metadataStatements(text, limits)) {
    const assignment = parseAssignment(statement, limits, enforce);
    if (assignment.keyword === "KEYS") throw keysUnsupported();
    if (
      enforce &&
      (assignment.keyword === "VALUES" || assignment.keyword === "CODES") &&
      assignment.values.length > limits.maxValuesPerDimension
    )
      throw dimensionLimit("A PC-Axis dimension metadata list has too many values.", {
        dimension: assignment.subkeys[0],
        language: assignment.language,
        limit: limits.maxValuesPerDimension,
        actual: assignment.values.length,
      });
    const id = assignmentId(assignment);
    if (!REPEATABLE_KEYWORDS.has(assignment.keyword) && seen.has(id))
      throw invalidPcAxis(`The PC-Axis assignment ${assignment.keyword} is duplicated.`, {
        keyword: assignment.keyword,
      });
    seen.add(id);
    if (NOTE_KEYWORDS.has(assignment.keyword)) {
      notes += 1;
      if (enforce && notes > limits.maxNotes)
        throw invalidPcAxis("PC-Axis notes exceed the configured count limit.", {
          limit: limits.maxNotes,
        });
    }
    if (assignment.language !== undefined) {
      languageVariants += 1;
      if (enforce && languageVariants > limits.maxLanguageVariants)
        throw invalidPcAxis("Language-qualified PC-Axis metadata exceeds the configured limit.", {
          limit: limits.maxLanguageVariants,
        });
    }
    assignments.push(assignment);
  }
  return assignments;
}

function declaredCodepage(text: string, limits: PcAxisLimits): string {
  let codepage: string | undefined;
  for (const statement of metadataStatements(text, limits)) {
    const equals = assignmentEquals(statement);
    if (equals < 0) throw invalidPcAxis("A PC-Axis metadata statement is missing an equals sign.");
    if (keywordFromLeft(statement.slice(0, equals)) !== "CODEPAGE") continue;
    const assignment = parseAssignment(statement, limits, false);
    if (assignment.language !== undefined || assignment.subkeys.length > 0)
      throw invalidPcAxis("The PC-Axis CODEPAGE assignment cannot have a language or subkey.");
    if (codepage !== undefined)
      throw invalidPcAxis("The PC-Axis assignment CODEPAGE is duplicated.", {
        keyword: "CODEPAGE",
      });
    codepage = exactlyOneValue(assignment, "CODEPAGE");
  }
  if (codepage === undefined) throw unsupportedEncoding(null);
  return codepage;
}

function exactlyOneValue(assignment: PxAssignment, name: string): string {
  const value = assignment.values[0];
  if (value === undefined || assignment.values.length !== 1)
    throw invalidPcAxis(`The PC-Axis ${name} assignment must contain exactly one value.`);
  return value;
}

function defaultAssignment(
  assignments: readonly PxAssignment[],
  keyword: string,
  subkey?: string,
): PxAssignment | undefined {
  return assignments.find(
    (assignment) =>
      assignment.keyword === keyword &&
      assignment.language === undefined &&
      (subkey === undefined
        ? assignment.subkeys.length === 0
        : assignment.subkeys.length === 1 && assignment.subkeys[0] === subkey),
  );
}

function optionalScalar(assignments: readonly PxAssignment[], keyword: string): string | undefined {
  const assignment = defaultAssignment(assignments, keyword);
  return assignment === undefined ? undefined : exactlyOneValue(assignment, keyword);
}

function dimensionNames(
  assignments: readonly PxAssignment[],
  keyword: "STUB" | "HEADING",
): readonly string[] {
  return defaultAssignment(assignments, keyword)?.values ?? [];
}

function buildDimensions(
  assignments: readonly PxAssignment[],
  limits: PcAxisLimits,
): readonly PxDimension[] {
  const roles: ReadonlyArray<readonly ["stub" | "heading", string]> = [
    ...dimensionNames(assignments, "STUB").map((name) => ["stub", name] as const),
    ...dimensionNames(assignments, "HEADING").map((name) => ["heading", name] as const),
  ];
  if (roles.length === 0)
    throw invalidPcAxis("The PC-Axis file must define at least one STUB or HEADING dimension.");
  if (roles.length > limits.maxDimensions)
    throw dimensionLimit("The PC-Axis file has too many dimensions.", {
      limit: limits.maxDimensions,
      actual: roles.length,
    });

  const dimensionNameSet = new Set<string>();
  const dimensions: PxDimension[] = [];
  for (const [role, name] of roles) {
    if (dimensionNameSet.has(name))
      throw invalidPcAxis("PC-Axis dimension names must be unique.", { dimension: name });
    dimensionNameSet.add(name);
    const valuesAssignment = defaultAssignment(assignments, "VALUES", name);
    if (valuesAssignment === undefined)
      throw invalidPcAxis("A dimension is missing its unqualified VALUES assignment.", {
        dimension: name,
      });
    if (valuesAssignment.values.length > limits.maxValuesPerDimension)
      throw dimensionLimit("A PC-Axis dimension has too many values.", {
        dimension: name,
        limit: limits.maxValuesPerDimension,
        actual: valuesAssignment.values.length,
      });
    const codes = defaultAssignment(assignments, "CODES", name)?.values;
    if (codes !== undefined && codes.length !== valuesAssignment.values.length)
      throw invalidPcAxis("A PC-Axis CODES list does not match its VALUES cardinality.", {
        dimension: name,
        values: valuesAssignment.values.length,
        codes: codes.length,
      });
    dimensions.push({
      name,
      role,
      values: valuesAssignment.values,
      ...(codes === undefined ? {} : { codes }),
    });
  }

  const dimensionsByName = new Map(dimensions.map((dimension) => [dimension.name, dimension]));
  for (const assignment of assignments) {
    if (assignment.keyword !== "VALUES" && assignment.keyword !== "CODES") continue;
    const dimensionName = assignment.subkeys[0];
    const dimension =
      assignment.subkeys.length === 1 && dimensionName !== undefined
        ? dimensionsByName.get(dimensionName)
        : undefined;
    if (dimension === undefined)
      throw invalidPcAxis(
        `A ${assignment.keyword} assignment does not identify a declared default dimension.`,
        {
          keyword: assignment.keyword,
          language: assignment.language,
          dimension: dimensionName,
        },
      );
    if (assignment.language !== undefined && assignment.values.length !== dimension.values.length)
      throw invalidPcAxis(
        `A language-qualified ${assignment.keyword} list does not match its default dimension cardinality.`,
        {
          keyword: assignment.keyword,
          language: assignment.language,
          dimension: dimension.name,
          expected: dimension.values.length,
          actual: assignment.values.length,
        },
      );
  }
  return dimensions;
}

function expectedCells(dimensions: readonly PxDimension[], limits: PcAxisLimits): number {
  let expected = 1;
  for (const dimension of dimensions) {
    const cardinality = dimension.values.length;
    if (cardinality === 0)
      throw invalidPcAxis("PC-Axis dimensions cannot have empty VALUES lists.", {
        dimension: dimension.name,
      });
    if (expected > Math.floor(limits.maxCells / cardinality))
      throw cellLimit("The PC-Axis dense cube exceeds the configured cell limit.", {
        limit: limits.maxCells,
        dimension: dimension.name,
      });
    expected *= cardinality;
  }
  return expected;
}

function buildDataSymbols(assignments: readonly PxAssignment[]): Readonly<Record<string, string>> {
  const symbols: Record<string, string> = Object.fromEntries(
    DATA_SYMBOLS.map((symbol) => [symbol, symbol]),
  );
  const names = [
    ["DATASYMBOLNIL", "-"],
    ["DATASYMBOL1", "."],
    ["DATASYMBOL2", ".."],
    ["DATASYMBOL3", "..."],
    ["DATASYMBOL4", "...."],
    ["DATASYMBOL5", "....."],
    ["DATASYMBOL6", "......"],
  ] as const;
  for (const [keyword, token] of names) {
    const assignment = defaultAssignment(assignments, keyword);
    if (assignment !== undefined) symbols[token] = exactlyOneValue(assignment, keyword);
  }
  return symbols;
}

function parseDecimals(assignments: readonly PxAssignment[]): number | undefined {
  const raw = optionalScalar(assignments, "DECIMALS");
  if (raw === undefined) return undefined;
  if (!/^\d+$/u.test(raw)) throw invalidPcAxis("DECIMALS must be an integer from 0 through 15.");
  const decimals = Number(raw);
  if (decimals < 0 || decimals > 15)
    throw invalidPcAxis("DECIMALS must be an integer from 0 through 15.");
  return decimals;
}

function collectNotes(assignments: readonly PxAssignment[]): readonly PxNote[] {
  return assignments
    .filter((assignment) => NOTE_KEYWORDS.has(assignment.keyword))
    .map((assignment) => ({
      keyword: assignment.keyword,
      ...(assignment.language === undefined ? {} : { language: assignment.language }),
      subkeys: assignment.subkeys,
      values: assignment.values,
    }));
}

function collectLanguageVariants(
  assignments: readonly PxAssignment[],
): readonly PxMetadataVariant[] {
  return assignments
    .filter(
      (assignment): assignment is PxAssignment & { readonly language: string } =>
        assignment.language !== undefined,
    )
    .map((assignment) => ({
      keyword: assignment.keyword,
      language: assignment.language,
      subkeys: assignment.subkeys,
      values: assignment.values,
    }));
}

function decoderFor(codepage: string): {
  readonly encoding: "windows-1250" | "utf-8";
  readonly decoder: InstanceType<typeof TextDecoder>;
} {
  const normalized = codepage.trim().toLowerCase();
  if (normalized !== "windows-1250" && normalized !== "utf-8") throw unsupportedEncoding(codepage);
  return {
    encoding: normalized,
    decoder: new TextDecoder(normalized, { fatal: true }),
  };
}

export async function parsePcAxisMetadata(
  path: string,
  limits: PcAxisLimits = DEFAULT_PCAXIS_LIMITS,
): Promise<PcAxisMetadata> {
  try {
    assertLimits(limits);
    const prefix = await readMetadataPrefix(path, limits);
    const codepage = declaredCodepage(prefix.bytes.toString("latin1"), limits);
    const { decoder, encoding } = decoderFor(codepage);
    const decoded = decoder.decode(prefix.bytes);
    const assignments = parseAssignments(decoded, limits, true);
    const decodedCodepage = defaultAssignment(assignments, "CODEPAGE");
    if (decodedCodepage === undefined) throw unsupportedEncoding(null);
    decoderFor(exactlyOneValue(decodedCodepage, "CODEPAGE"));

    const matrixAssignment = defaultAssignment(assignments, "MATRIX");
    if (matrixAssignment === undefined)
      throw invalidPcAxis("The mandatory MATRIX assignment is missing.");
    const matrix = exactlyOneValue(matrixAssignment, "MATRIX");
    const dimensions = buildDimensions(assignments, limits);
    const decimals = parseDecimals(assignments);
    const unit = optionalScalar(assignments, "UNITS");
    const title = optionalScalar(assignments, "TITLE");
    const contents = optionalScalar(assignments, "CONTENTS");
    const source = optionalScalar(assignments, "SOURCE");
    const database = optionalScalar(assignments, "DATABASE");
    return {
      encoding,
      dimensions,
      ...(decimals === undefined ? {} : { decimals }),
      ...(unit === undefined ? {} : { unit }),
      matrix,
      ...(title === undefined ? {} : { title }),
      ...(contents === undefined ? {} : { contents }),
      ...(source === undefined ? {} : { source }),
      ...(database === undefined ? {} : { database }),
      dataSymbols: buildDataSymbols(assignments),
      notes: collectNotes(assignments),
      languageVariants: collectLanguageVariants(assignments),
      expectedCellCount: expectedCells(dimensions, limits),
      dataOffset: prefix.dataOffset,
    };
  } catch (error) {
    throw normalizePcAxisError(error);
  }
}

function isDelimiter(character: string): boolean {
  return character === "," || character === ";" || /\s/u.test(character);
}

async function* dataTokens(
  path: string,
  metadata: PcAxisMetadata,
  limits: PcAxisLimits,
  signal?: AbortSignal,
): AsyncGenerator<CellToken> {
  const stream = createReadStream(path, { start: metadata.dataOffset });
  const decoder = new TextDecoder(metadata.encoding, { fatal: true });
  let token = "";
  let tokenBytes = 0;
  let started = false;
  let quoted = false;
  let inQuotes = false;
  let afterQuote = false;
  let hasFinalTerminator = false;

  const append = (character: string): void => {
    token += character;
    tokenBytes += Buffer.byteLength(character, "utf8");
    if (tokenBytes > limits.maxCellTokenBytes)
      throw invalidPcAxis("A PC-Axis DATA token exceeds the configured byte limit.", {
        limit: limits.maxCellTokenBytes,
      });
  };
  const take = (): CellToken => {
    const result = { value: token, quoted };
    token = "";
    tokenBytes = 0;
    started = false;
    quoted = false;
    inQuotes = false;
    afterQuote = false;
    return result;
  };

  function* scan(text: string): Generator<CellToken> {
    for (const character of text) {
      signal?.throwIfAborted();
      if (!inQuotes && !/\s/u.test(character)) hasFinalTerminator = character === ";";
      if (!started) {
        if (isDelimiter(character)) continue;
        started = true;
        if (character === '"') {
          quoted = true;
          inQuotes = true;
        } else append(character);
        continue;
      }
      if (inQuotes) {
        if (character === '"') {
          inQuotes = false;
          afterQuote = true;
        } else append(character);
        continue;
      }
      if (afterQuote) {
        if (character === '"') {
          append('"');
          inQuotes = true;
          afterQuote = false;
        } else if (isDelimiter(character)) yield take();
        else throw invalidPcAxis("Unexpected text follows a quoted PC-Axis DATA token.");
        continue;
      }
      if (isDelimiter(character)) yield take();
      else if (character === '"')
        throw invalidPcAxis("A quotation mark appears inside an unquoted PC-Axis DATA token.");
      else append(character);
    }
  }

  try {
    for await (const raw of stream) {
      signal?.throwIfAborted();
      const text = decoder.decode(Buffer.from(raw as Uint8Array), { stream: true });
      yield* scan(text);
    }
    yield* scan(decoder.decode());
    if (inQuotes) throw invalidPcAxis("A quoted PC-Axis DATA token is unterminated.");
    if (started) yield take();
    if (!hasFinalTerminator)
      throw invalidPcAxis(
        "The PC-Axis DATA assignment is missing its final terminating semicolon.",
      );
  } finally {
    stream.destroy();
  }
}

function parseCell(token: CellToken): ParsedCell {
  if (/^(?:-|\.{1,6})$/u.test(token.value)) {
    if (!token.quoted)
      throw invalidPcAxis("Dash and one-to-six-dot PC-Axis DATA symbols must be quoted.", {
        token: token.value,
      });
    return { value: null, symbol: token.value };
  }
  if (token.quoted)
    throw invalidPcAxis("Numeric PC-Axis DATA tokens cannot be quoted.", {
      token: token.value,
    });
  if (!NUMBER_TOKEN.test(token.value))
    throw invalidPcAxis("A PC-Axis DATA token is neither a number nor a supported data symbol.", {
      token: token.value,
    });
  const value = Number(token.value);
  if (!Number.isFinite(value))
    throw invalidPcAxis("A numeric PC-Axis DATA token is outside the supported numeric range.", {
      token: token.value,
    });
  return { value };
}

function columnBindings(dimensions: readonly PxDimension[]): {
  readonly bindings: readonly ColumnBinding[];
  readonly baseColumns: readonly string[];
  readonly codeColumns: readonly string[];
} {
  const identifierKey = (identifier: string): string =>
    identifier.replace(/[A-Z]/gu, (character) => character.toLowerCase());
  const reserved = new Set(["value", "value__symbol"].map(identifierKey));
  const used = new Set<string>();
  const allocate = (base: string): string => {
    const normalized = base.trim().length === 0 ? "dimension" : base.trim();
    const normalizedKey = identifierKey(normalized);
    if (!reserved.has(normalizedKey) && !used.has(normalizedKey)) {
      used.add(normalizedKey);
      return normalized;
    }
    let suffix = 2;
    while (true) {
      const candidate = `${normalized}__${suffix}`;
      const candidateKey = identifierKey(candidate);
      if (!reserved.has(candidateKey) && !used.has(candidateKey)) {
        used.add(candidateKey);
        return candidate;
      }
      suffix += 1;
    }
  };

  const bindings: ColumnBinding[] = [];
  const columns: string[] = [];
  const codeColumns: string[] = [];
  for (const dimension of dimensions) {
    const label = allocate(dimension.name);
    const code = dimension.codes === undefined ? undefined : allocate(`${label}__code`);
    bindings.push({ label, ...(code === undefined ? {} : { code }) });
    columns.push(label);
    if (code !== undefined) {
      columns.push(code);
      codeColumns.push(code);
    }
  }
  columns.push("value");
  return { bindings, baseColumns: columns, codeColumns };
}

function rowForCell(
  metadata: PcAxisMetadata,
  bindings: readonly ColumnBinding[],
  coordinate: readonly number[],
  cell: ParsedCell,
): DataRow {
  const row: Record<string, unknown> = {};
  const setOwn = (name: string, value: unknown): void => {
    Object.defineProperty(row, name, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  };
  for (let index = 0; index < metadata.dimensions.length; index += 1) {
    const dimension = metadata.dimensions[index];
    const binding = bindings[index];
    const position = coordinate[index];
    if (dimension === undefined || binding === undefined || position === undefined)
      throw invalidPcAxis("The dense PC-Axis coordinate state is inconsistent.");
    setOwn(binding.label, dimension.values[position]);
    if (binding.code !== undefined) setOwn(binding.code, dimension.codes?.[position]);
  }
  row.value = cell.value;
  if (cell.symbol !== undefined) row.value__symbol = cell.symbol;
  return row;
}

function advanceCoordinate(coordinate: number[], dimensions: readonly PxDimension[]): void {
  for (let index = coordinate.length - 1; index >= 0; index -= 1) {
    const next = (coordinate[index] ?? 0) + 1;
    const dimension = dimensions[index];
    if (dimension === undefined) return;
    if (next < dimension.values.length) {
      coordinate[index] = next;
      return;
    }
    coordinate[index] = 0;
  }
}

function warningsFromSymbols(symbols: ReadonlyMap<string, number>): readonly ValidationIssue[] {
  return [...symbols.entries()].map(([symbol, occurrences]) => ({
    code: "PCAXIS_DATA_SYMBOL",
    severity: "warning",
    message: `The source DATA contains the PC-Axis symbol "${symbol}", emitted as null.`,
    recommendation: "Review the source metadata before interpreting missing or suppressed values.",
    context: { symbol, occurrences },
  }));
}

function chargeSymbol(symbols: Map<string, number>, symbol: string | undefined): void {
  if (symbol !== undefined) symbols.set(symbol, (symbols.get(symbol) ?? 0) + 1);
}

export async function writePcAxisBufferFully(
  target: {
    write(
      buffer: Uint8Array,
      offset: number,
      length: number,
      position: null,
    ): Promise<{ readonly bytesWritten: number }>;
  },
  buffer: Uint8Array,
): Promise<void> {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const remaining = buffer.byteLength - offset;
    const { bytesWritten } = await target.write(buffer, offset, remaining, null);
    if (!Number.isSafeInteger(bytesWritten) || bytesWritten <= 0 || bytesWritten > remaining)
      throw invalidPcAxis("PC-Axis staging could not complete a file write.", {
        requested: remaining,
        bytesWritten,
      });
    offset += bytesWritten;
  }
}

export async function previewPcAxis(
  path: string,
  options: { readonly limit?: number; readonly signal?: AbortSignal } = {},
  limits: PcAxisLimits = DEFAULT_PCAXIS_LIMITS,
): Promise<PcAxisPreview> {
  try {
    options.signal?.throwIfAborted();
    const limit = options.limit ?? 20;
    if (!Number.isSafeInteger(limit) || limit < 0)
      throw invalidPcAxis("The PC-Axis preview limit must be a non-negative safe integer.");
    if (limit > limits.maxEmittedRecords)
      throw cellLimit("The requested PC-Axis preview exceeds the emitted-record limit.", {
        limit: limits.maxEmittedRecords,
        requested: limit,
      });
    const metadata = await parsePcAxisMetadata(path, limits);
    options.signal?.throwIfAborted();
    const { bindings, baseColumns, codeColumns } = columnBindings(metadata.dimensions);
    const rows: DataRow[] = [];
    const symbols = new Map<string, number>();
    const coordinate = metadata.dimensions.map(() => 0);
    const target = Math.min(limit, metadata.expectedCellCount);
    if (target > 0 || metadata.expectedCellCount <= limit) {
      let actual = 0;
      for await (const token of dataTokens(path, metadata, limits, options.signal)) {
        if (actual >= metadata.expectedCellCount)
          throw cellCountMismatch(metadata.expectedCellCount, actual + 1);
        const cell = parseCell(token);
        if (actual < target) {
          rows.push(rowForCell(metadata, bindings, coordinate, cell));
          chargeSymbol(symbols, cell.symbol);
        }
        actual += 1;
        advanceCoordinate(coordinate, metadata.dimensions);
        if (metadata.expectedCellCount > limit && actual === target) break;
      }
      if (
        actual < target ||
        (metadata.expectedCellCount <= limit && actual !== metadata.expectedCellCount)
      )
        throw cellCountMismatch(metadata.expectedCellCount, actual);
    }
    const hasSymbols = rows.some((row) => Object.hasOwn(row, "value__symbol"));
    return {
      format: "pcaxis",
      columns: hasSymbols ? [...baseColumns, "value__symbol"] : baseColumns,
      codeColumns,
      rows,
      returnedCount: rows.length,
      truncated: metadata.expectedCellCount > rows.length,
      warnings: warningsFromSymbols(symbols),
      encoding: metadata.encoding,
    };
  } catch (error) {
    if (options.signal?.aborted === true && error === options.signal.reason) throw error;
    throw normalizePcAxisError(error);
  }
}

export async function writePcAxisRowsAsNdjson(
  path: string,
  output: string,
  options: { readonly signal?: AbortSignal } = {},
  limits: PcAxisLimits = DEFAULT_PCAXIS_LIMITS,
): Promise<{
  readonly rows: number;
  readonly columns: readonly string[];
  readonly warnings: readonly ValidationIssue[];
  readonly encoding: "windows-1250" | "utf-8";
}> {
  options.signal?.throwIfAborted();
  let outputHandle: FileHandle | undefined;
  let created = false;
  try {
    const metadata = await parsePcAxisMetadata(path, limits);
    options.signal?.throwIfAborted();
    if (metadata.expectedCellCount > limits.maxEmittedRecords)
      throw cellLimit("The PC-Axis dense cube exceeds the emitted-record limit.", {
        limit: limits.maxEmittedRecords,
        actual: metadata.expectedCellCount,
      });
    const { bindings, baseColumns } = columnBindings(metadata.dimensions);
    outputHandle = await open(output, "wx", 0o600);
    created = true;
    const coordinate = metadata.dimensions.map(() => 0);
    const symbols = new Map<string, number>();
    let rows = 0;
    let stagingBytes = 0;
    for await (const token of dataTokens(path, metadata, limits, options.signal)) {
      options.signal?.throwIfAborted();
      if (rows >= metadata.expectedCellCount)
        throw cellCountMismatch(metadata.expectedCellCount, rows + 1);
      const cell = parseCell(token);
      const row = rowForCell(metadata, bindings, coordinate, cell);
      const line = Buffer.from(`${JSON.stringify(row)}\n`);
      stagingBytes += line.length;
      if (stagingBytes > limits.maxStagingBytes)
        throw cellLimit("PC-Axis NDJSON staging exceeds the configured byte limit.", {
          limit: limits.maxStagingBytes,
        });
      await writePcAxisBufferFully(outputHandle, line);
      rows += 1;
      chargeSymbol(symbols, cell.symbol);
      advanceCoordinate(coordinate, metadata.dimensions);
    }
    if (rows !== metadata.expectedCellCount)
      throw cellCountMismatch(metadata.expectedCellCount, rows);
    const warnings = warningsFromSymbols(symbols);
    return {
      rows,
      columns: symbols.size === 0 ? baseColumns : [...baseColumns, "value__symbol"],
      warnings,
      encoding: metadata.encoding,
    };
  } catch (error) {
    if (outputHandle !== undefined) await outputHandle.close().catch(() => undefined);
    outputHandle = undefined;
    if (created) await rm(output, { force: true });
    if (options.signal?.aborted === true && error === options.signal.reason) throw error;
    throw normalizePcAxisError(error);
  } finally {
    if (outputHandle !== undefined) await outputHandle.close();
  }
}
