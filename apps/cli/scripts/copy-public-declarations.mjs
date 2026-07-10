import { copyFile } from "node:fs/promises";
import { URL } from "node:url";

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
