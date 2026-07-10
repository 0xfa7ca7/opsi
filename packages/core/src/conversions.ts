import type { ConversionResult, SupportedDataFormat } from "@opsi/data-engine";
import type { DataService, DataResolutionOptions } from "./data.js";

export interface ConversionServiceOptions extends DataResolutionOptions {
  readonly output: string;
  readonly targetFormat: SupportedDataFormat;
  readonly sheet?: string;
  readonly force?: boolean;
  readonly spreadsheetSafe?: boolean;
}

export class ConversionService {
  constructor(private readonly data: DataService) {}

  convert(input: string, options: ConversionServiceOptions): Promise<ConversionResult> {
    return this.data.convert(input, options);
  }
}
