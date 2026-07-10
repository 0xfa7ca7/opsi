import { Readable } from "node:stream";
import process from "node:process";
import { ContentCache } from "../../dist/index.js";

const [root, key, content] = process.argv.slice(2);
if (root === undefined || key === undefined || content === undefined || process.send === undefined)
  throw new Error("cache publisher requires IPC and root/key/content arguments");

process.send({ type: "ready" });
process.once("message", async (message) => {
  if (message !== "publish") throw new Error("unexpected parent message");
  try {
    const cache = new ContentCache(root);
    const object = await cache.putObjectWithMetadata(key, "race-v1", Readable.from([content]), {
      publisher: process.pid,
    });
    process.send?.({ type: "result", object, publisher: process.pid });
    process.disconnect();
  } catch (error) {
    process.send?.({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
    process.disconnect();
  }
});
