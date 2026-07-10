import { validateDatasetMetadata, validateResourceMetadata, type OpsiClient } from "@opsi/core";
import { EXIT_CODES, OpsiError, parseCanonicalReference } from "@opsi/domain";
import type { Command } from "commander";
import type { CliContext } from "../context.js";
import { manifestCommand } from "../command-manifest.js";

export function registerValidateCommand(
  program: Command,
  context: CliContext,
  client: OpsiClient,
): void {
  manifestCommand(program, "validate").action(
    async (
      input: string,
      options: {
        readonly metadata?: boolean;
        readonly sheet?: string;
        readonly allowInsecureHttp?: boolean;
        readonly allowPrivateNetwork?: boolean;
      },
    ) => {
      const validation = options.metadata
        ? await validateMetadata(input, client)
        : await client.data.validate(input, {
            ...(options.sheet === undefined ? {} : { sheet: options.sheet }),
            allowInsecureHttp: options.allowInsecureHttp ?? false,
            allowPrivateNetwork: options.allowPrivateNetwork ?? false,
          });
      if (!validation.valid)
        if (context.configuration?.output === "human") context.renderer?.write(validation.issues);
      if (!validation.valid)
        throw new OpsiError({
          code: "VALIDATION_FAILED",
          message: `Validation found ${validation.errors.length} error(s).`,
          exitCode: EXIT_CODES.INTEGRITY_FAILURE,
          suggestion: "Review the reported issues and recommendations, then validate again.",
          context: { data: validation },
        });
      context.renderer?.write(validation);
    },
  );
}

async function validateMetadata(input: string, client: OpsiClient) {
  const reference = parseCanonicalReference(input);
  if (reference.kind === "dataset")
    return validateDatasetMetadata(await client.datasets.get(reference.id, reference.providerId));
  if (reference.kind === "resource")
    return validateResourceMetadata(await client.resources.get(reference.id, reference.providerId));
  throw new OpsiError({
    code: "METADATA_REFERENCE_REQUIRED",
    message: "Metadata validation requires a canonical dataset or resource reference.",
    exitCode: EXIT_CODES.INVALID_INPUT,
    suggestion: "Use <provider>:dataset:<id> or <provider>:resource:<id>.",
  });
}
