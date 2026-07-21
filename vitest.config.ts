import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const workspacePackage = (path: string): string => fileURLToPath(new URL(path, import.meta.url));
const workspaceResolve = {
  alias: {
    "@klopsi/catalogue-snapshot": workspacePackage("./packages/catalogue-snapshot/src/index.ts"),
    "@klopsi/config": workspacePackage("./packages/config/src/index.ts"),
    "@klopsi/core": workspacePackage("./packages/core/src/index.ts"),
    "@klopsi/domain": workspacePackage("./packages/domain/src/index.ts"),
    "@klopsi/data-engine": workspacePackage("./packages/data-engine/src/index.ts"),
    "@klopsi/output": workspacePackage("./packages/output/src/index.ts"),
    "@klopsi/provider-local": workspacePackage("./packages/providers/local/src/index.ts"),
    "@klopsi/provider-opsi": workspacePackage("./packages/providers/opsi/src/index.ts"),
    "@klopsi/storage": workspacePackage("./packages/storage/src/index.ts"),
  },
};

const defaultProject = {
  environment: "node" as const,
  exclude: ["**/*.live.test.ts", "**/node_modules/**"],
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
          exclude: [
            ...defaultProject.exclude,
            "**/*.integration.test.ts",
            "**/*.e2e.test.ts",
            "apps/cli/test/pack.test.ts",
            "packages/storage/test/**",
          ],
        },
      },
      {
        resolve: workspaceResolve,
        test: {
          ...defaultProject,
          name: "integration",
          include: [
            "apps/cli/test/**/*.integration.test.ts",
            "packages/**/*.integration.test.ts",
            "packages/storage/test/**/*.test.ts",
            "packages/data-engine/test/**/*.test.ts",
            "packages/providers/local/test/**/*.test.ts",
            "packages/core/test/metadata-validation.test.ts",
          ],
        },
      },
      {
        resolve: workspaceResolve,
        test: {
          ...defaultProject,
          name: "cli-e2e",
          include: ["apps/cli/**/*.e2e.test.ts", "apps/cli/test/pack.test.ts"],
          testTimeout: 30_000,
          hookTimeout: 30_000,
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
