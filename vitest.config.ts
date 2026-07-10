import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const workspacePackage = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const workspaceResolve = {
  alias: {
    "@opsi/config": workspacePackage("./packages/config/src/index.ts"),
    "@opsi/core": workspacePackage("./packages/core/src/index.ts"),
    "@opsi/domain": workspacePackage("./packages/domain/src/index.ts"),
    "@opsi/output": workspacePackage("./packages/output/src/index.ts"),
    "@opsi/provider-opsi": workspacePackage("./packages/providers/opsi/src/index.ts"),
  },
};

const defaultProject = {
  environment: "node" as const,
  exclude: ["**/*.live.test.ts"],
};

export default defineConfig({
  resolve: {
    ...workspaceResolve,
  },
  test: {
    projects: [
      {
        resolve: workspaceResolve,
        test: {
          ...defaultProject,
          name: "unit",
          include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
          exclude: [...defaultProject.exclude, "**/*.integration.test.ts", "**/*.e2e.test.ts"],
        },
      },
      {
        resolve: workspaceResolve,
        test: {
          ...defaultProject,
          name: "integration",
          include: ["packages/**/*.integration.test.ts"],
        },
      },
      {
        resolve: workspaceResolve,
        test: {
          ...defaultProject,
          name: "cli-e2e",
          include: ["apps/cli/**/*.e2e.test.ts"],
        },
      },
      {
        resolve: workspaceResolve,
        test: {
          name: "live",
          environment: "node",
          include: ["**/*.live.test.ts"],
        },
      },
    ],
  },
});
