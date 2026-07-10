import { defineConfig } from "vitest/config";

const defaultProject = {
  environment: "node" as const,
  exclude: ["**/*.live.test.ts"],
};

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...defaultProject,
          name: "unit",
          include: ["packages/**/test/**/*.test.ts", "apps/**/test/**/*.test.ts"],
          exclude: [...defaultProject.exclude, "**/*.integration.test.ts", "**/*.e2e.test.ts"],
        },
      },
      {
        test: {
          ...defaultProject,
          name: "integration",
          include: ["packages/**/*.integration.test.ts"],
        },
      },
      {
        test: {
          ...defaultProject,
          name: "cli-e2e",
          include: ["apps/cli/**/*.e2e.test.ts"],
        },
      },
      {
        test: {
          name: "live",
          environment: "node",
          include: ["**/*.live.test.ts"],
        },
      },
    ],
  },
});
