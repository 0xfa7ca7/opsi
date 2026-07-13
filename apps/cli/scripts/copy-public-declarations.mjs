import { copyFile, readdir, rm } from "node:fs/promises";
import { URL } from "node:url";

const dist = new URL("../dist/", import.meta.url);
const publicDeclarations = new Set(["main.d.ts", "query-worker.d.ts", "sdk.d.ts"]);

await Promise.all([
  copyFile(
    new URL("../src/public-sdk.d.ts", import.meta.url),
    new URL("../dist/sdk.d.ts", import.meta.url),
  ),
  copyFile(
    new URL("../src/public-main.d.ts", import.meta.url),
    new URL("../dist/main.d.ts", import.meta.url),
  ),
]);

await Promise.all(
  (await readdir(dist, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.isFile() && entry.name.endsWith(".d.ts") && !publicDeclarations.has(entry.name),
    )
    .map((entry) => rm(new URL(entry.name, dist))),
);
