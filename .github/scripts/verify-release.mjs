import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export function verifyRelease(manifest, assets, version) {
  assert.equal(manifest.version.replace(/^v/, ""), version, "Updater version mismatch");
  const available = new Set(assets.map((asset) => asset.name));
  assert(available.has("latest.json"), "Missing updater manifest");
  for (const platform of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"]) {
    const entry = manifest.platforms?.[platform];
    assert(entry, `Missing updater platform: ${platform}`);
    const url = new URL(entry.url);
    assert.equal(url.protocol, "https:");
    assert.equal(url.hostname, "github.com");
    assert(
      url.pathname.startsWith(`/Leon-Achteresch/l8db/releases/download/v${version}/`),
      `Wrong release URL: ${platform}`,
    );
    const filename = decodeURIComponent(url.pathname.split("/").at(-1));
    assert(available.has(filename), `Missing installer: ${filename}`);
    assert(available.has(`${filename}.sig`), `Missing update signature: ${filename}`);
    assert(
      typeof entry.signature === "string" && entry.signature.trim().length > 0,
      `Empty update signature: ${platform}`,
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [manifestPath, assetsPath, version] = process.argv.slice(2);
  assert(
    manifestPath && assetsPath && version,
    "Usage: verify-release.mjs manifest.json assets.json version",
  );
  verifyRelease(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    JSON.parse(readFileSync(assetsPath, "utf8")).assets,
    version,
  );
  console.log("All platform update artifacts are present");
}
