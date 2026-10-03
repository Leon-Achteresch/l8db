import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { verifyExecutable } from "./release-artifacts.mjs";
import { buildEquivalent, git } from "./release-utils.mjs";

const targets = {
  macos: "darwin-universal",
  "macos-arm64": "darwin-arm64",
  "macos-x64": "darwin-x86_64",
  linux: "linux-x86_64",
  windows: "windows-x86_64",
};
const platform = process.env.RELEASE_PLATFORM;
assert(Object.hasOwn(targets, platform), "Invalid build platform");
const file = process.env.RELEASE_BINARY;
assert(file, "Missing build binary");
const binary = readFileSync(file);
verifyExecutable(binary, targets[platform]);
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
else if (process.argv[2] === "verify") {
  const recorded = JSON.parse(readFileSync(path, "utf8"));
  assert(
    buildEquivalent(recorded.sourceSha, metadata.sourceSha),
    "Compiled snapshot source differs from release source",
  );
  assert.deepEqual(
    { ...recorded, sourceSha: metadata.sourceSha },
    metadata,
    "Compiled snapshot does not match release source, version or toolchain",
  );
  writeFileSync(
    path,
    `${JSON.stringify({ ...metadata, compiledFrom: recorded.sourceSha }, null, 2)}\n`,
  );
} else throw new Error("Usage: build-snapshot.mjs record|verify");
console.log(`${platform} compiled snapshot ${metadata.binarySha256} verified`);
