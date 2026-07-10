#!/usr/bin/env node

const VERSION = "0.1.0";

if (process.argv.includes("--version")) {
  process.stdout.write(`${VERSION}\n`);
}
