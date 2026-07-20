import type { Command } from "commander";
import { generateAgentSkills } from "../agent-skills.js";
import { manifestCommand } from "../command-manifest.js";
import type { CliContext } from "../context.js";

interface GenerateSkillsCommandOptions {
  readonly outputDir?: string;
}

export function registerGenerateSkillsCommand(program: Command, context: CliContext): void {
  manifestCommand(program, "generate-skills").action(
    async (options: GenerateSkillsCommandOptions) => {
      const result = await generateAgentSkills({
        cwd: context.io.cwd ?? process.cwd(),
        version: context.version,
        ...(options.outputDir === undefined ? {} : { outputDirectory: options.outputDir }),
      });
      context.renderer?.write(result);
    },
  );
}
