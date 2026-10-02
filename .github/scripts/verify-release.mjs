import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { verifyArtifacts, verifyManifest } from "./release-artifacts.mjs";

const REPO = "Leon-Achteresch/l8db";

export function normalizeManifest(manifest, assets, version) {
  const names = new Map(
    assets.map((asset) => [
      String(asset.apiUrl ?? asset.url ?? "")
        .split("/")
        .at(-1),
      asset.name,
    ]),
  );
  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    const url = new URL(entry.url);
    if (url.hostname !== "api.github.com") continue;
    assert.equal(url.protocol, "https:");
    assert(!url.username && !url.password && !url.search && !url.hash, "Invalid asset API URL");
    assert(url.pathname.startsWith(`/repos/${REPO}/releases/assets/`), "Wrong asset repository");
    const name = names.get(url.pathname.split("/").at(-1));
    assert(name, `Unknown release asset for ${platform}: ${entry.url}`);
    entry.url = `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(name)}`;
  }
  return manifest;
}

export function verifyRelease(manifest, assets, version) {
  verifyManifest(manifest, assets, version);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, assetsPath, version, directory] = process.argv.slice(2);
  assert(
    manifestPath && assetsPath && version && directory,
    "Usage: verify-release.mjs manifest.json assets.json version artifact-directory",
  );
  const assets = JSON.parse(readFileSync(assetsPath, "utf8")).assets;
  const manifest = normalizeManifest(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    assets,
    version,
  );
  const publicKey = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).plugins.updater
    .pubkey;
  await verifyArtifacts(manifest, assets, version, directory, publicKey);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log("All platform artifacts and updater signatures verified");
}
