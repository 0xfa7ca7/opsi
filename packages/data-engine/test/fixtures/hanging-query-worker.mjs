import process from "node:process";

process.on("SIGINT", () => {});
process.on("SIGTERM", () => {});
process.on("message", () => {});
