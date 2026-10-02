import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { artifactNames, verifyArtifactFormat } from "./release-artifacts.mjs";

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : entry.isFile()
        ? [join(directory, entry.name)]
        : [],
  );
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const platform = process.env.RELEASE_PLATFORM;
const bundle = process.env.RELEASE_BUNDLE;
assert(bundle && ["macos", "linux", "windows"].includes(platform), "Invalid packaging target");
const names = artifactNames(version);
const directory = "release-assets";
mkdirSync(directory, { recursive: true });
const expected = {
  macos: ["mac", "dmg"],
  linux: ["appimage", "deb", "rpm"],
  windows: ["nsis", "msi"],
}[platform];
const candidates = files(bundle);
for (const kind of expected) {
  const name = names[kind];
  const matches = candidates.filter(
    (file) => basename(file) === name || (kind === "mac" && basename(file) === "l8db.app.tar.gz"),
  );
  assert.equal(matches.length, 1, `Expected exactly one ${name}`);
  verifyArtifactFormat(matches[0], kind);
  copyFileSync(matches[0], join(directory, name));
  if (kind !== "dmg") copyFileSync(`${matches[0]}.sig`, join(directory, `${name}.sig`));
}
const metadata = JSON.parse(readFileSync(`build-${platform}.json`, "utf8"));
const packagedBinary =
  platform === "macos"
    ? join(bundle, "macos/l8db.app/Contents/MacOS/l8db")
    : process.env.RELEASE_BINARY;
metadata.packagedBinarySha256 = createHash("sha256")
  .update(readFileSync(packagedBinary))
  .digest("hex");
writeFileSync(join(directory, `build-${platform}.json`), `${JSON.stringify(metadata, null, 2)}\n`);
if (platform === "windows") {
  const msi = join(process.cwd(), directory, names.msi);
  const productCode = execFileSync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-File", ".github/scripts/msi-product-code.ps1"],
    { encoding: "utf8", env: { ...process.env, L8DB_RELEASE_MSI: msi } },
  ).trim();
  assert(
    /^\{[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12}\}$/.test(
      productCode,
    ),
    "Cannot read MSI ProductCode",
  );
  writeFileSync(
    join(directory, "packaging-metadata.json"),
    `${JSON.stringify({ version, productCode }, null, 2)}\n`,
  );
}
console.log(`Collected ${platform} installers for v${version}`);
