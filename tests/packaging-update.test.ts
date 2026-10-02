import { afterEach, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { artifactNames, publicAssetUrl } from "../.github/scripts/release-artifacts.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "l8db-packaging-"));
  directories.push(root);
  cpSync("packaging", join(root, "packaging"), { recursive: true });
  const license = join(root, "LICENSE");
  writeFileSync(license, "Test license\n");
  const names = artifactNames("0.8.25");
  const assets = [names.dmg, names.msi, names.deb].map((name, index) => ({
    name,
    browser_download_url: publicAssetUrl("0.8.25", name),
    digest: `sha256:${String(index + 1).repeat(64)}`,
  }));
  const release = { tag_name: "v0.8.25", published_at: "2026-10-02T12:00:00Z", assets };
  const metadata = {
    format: 1,
    version: "0.8.25",
    licenseSha256: createHash("sha256").update(readFileSync(license)).digest("hex"),
    productCode: "{01234567-89AB-CDEF-0123-456789ABCDEF}",
    artifacts: Object.fromEntries(assets.map((asset) => [asset.name, asset.digest.slice(7)])),
  };
  const releaseFile = join(root, "release.json");
  const metadataFile = join(root, "release-metadata.json");
  const run = (...args: string[]) => {
    writeFileSync(releaseFile, JSON.stringify(release));
    writeFileSync(metadataFile, JSON.stringify(metadata));
    return spawnSync(
      "node",
      [
        resolve("scripts/update-packaging.mjs"),
        "--root",
        root,
        "--release",
        releaseFile,
        "--metadata",
        metadataFile,
        "--license-file",
        license,
        ...args,
      ],
      { encoding: "utf8" },
    );
  };
  return { root, release, metadata, run, names };
}

test("updates every packaging manifest with matching hashes and MSI ProductCode", () => {
  const value = fixture();
  const result = value.run();
  expect(result.stderr).toBe("");
  expect(result.status).toBe(0);
  const read = (name: string) => readFileSync(join(value.root, "packaging", name), "utf8");
  expect(read("homebrew/l8db.rb")).toContain('version "0.8.25"');
  expect(read("homebrew/l8db.rb")).toContain(value.metadata.artifacts[value.names.dmg]);
  expect(read("winget/LeonAchteresch.l8db.installer.yaml")).toContain(value.metadata.productCode);
  expect(read("winget/LeonAchteresch.l8db.installer.yaml")).toContain("ReleaseDate: 2026-10-02");
  expect(read("aur/PKGBUILD")).toContain("pkgver=0.8.25");
  expect(read("aur/PKGBUILD")).toContain(value.metadata.licenseSha256);
  expect(read("aur/.SRCINFO")).toContain("pkgrel = 1");
  expect(read("aur/.SRCINFO")).toContain(value.metadata.artifacts[value.names.deb]);
  expect(read("aur/.SRCINFO")).toContain(value.metadata.licenseSha256);
  expect(read("flatpak/com.leon.l8db.yml")).toContain(publicAssetUrl("0.8.25", value.names.deb));
  expect(value.run().stdout).toContain("0 Datei(en) geaendert");
});

test("missing or mismatched hashes fail without partially changing manifests", () => {
  for (const problem of [
    "missing",
    "mismatch",
    "license",
    "product-code",
    "asset",
    "url",
  ] as const) {
    const value = fixture();
    const file = join(value.root, "packaging/homebrew/l8db.rb");
    const before = readFileSync(file, "utf8");
    if (problem === "missing") value.release.assets[0].digest = "";
    if (problem === "mismatch") value.release.assets[0].digest = `sha256:${"f".repeat(64)}`;
    if (problem === "license") value.metadata.licenseSha256 = "f".repeat(64);
    if (problem === "product-code") value.metadata.productCode = "";
    if (problem === "asset") value.release.assets.pop();
    if (problem === "url")
      value.release.assets[0].browser_download_url = "https://example.com/installer.dmg";
    expect(value.run().status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe(before);
  }
});

test("missing template fields fail before writing and dry runs leave files unchanged", () => {
  const value = fixture();
  const file = join(value.root, "packaging/homebrew/l8db.rb");
  const before = readFileSync(file, "utf8");
  expect(value.run("--dry-run").status).toBe(0);
  expect(readFileSync(file, "utf8")).toBe(before);
  writeFileSync(join(value.root, "packaging/flatpak/com.leon.l8db.yml"), "modules: []\n");
  expect(value.run().status).not.toBe(0);
  expect(readFileSync(file, "utf8")).toBe(before);
});
