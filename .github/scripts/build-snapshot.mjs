import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyExecutable } from "./release-artifacts.mjs";
import { git } from "./release-utils.mjs";

const platform = process.env.RELEASE_PLATFORM;
assert(["macos", "linux", "windows"].includes(platform), "Invalid build platform");
const file = process.env.RELEASE_BINARY;
assert(file, "Missing build binary");
const binary = readFileSync(file);
verifyExecutable(
  binary,
  { macos: "darwin-universal", linux: "linux-x86_64", windows: "windows-x86_64" }[platform],
);
const metadata = {
  format: 1,
  version: JSON.parse(readFileSync("package.json", "utf8")).version,
  sourceSha: git("rev-parse", "HEAD"),
  platform,
  binarySha256: createHash("sha256").update(binary).digest("hex"),
  rust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
};
const path = `build-${platform}.json`;
if (process.argv[2] === "record") writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
else if (process.argv[2] === "verify")
  assert.deepEqual(
    JSON.parse(readFileSync(path, "utf8")),
    metadata,
    "Compiled snapshot does not match release source, version or toolchain",
  );
else throw new Error("Usage: build-snapshot.mjs record|verify");
console.log(`${platform} compiled snapshot ${metadata.binarySha256} verified`);
