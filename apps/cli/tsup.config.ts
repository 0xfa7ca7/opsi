import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  target: "node24",
  platform: "node",
  sourcemap: true,
  clean: true,
  splitting: false,
  noExternal: [/^@opsi\//],
  external: ["undici", "@duckdb/node-api", "csv-parse", "exceljs"],
});
