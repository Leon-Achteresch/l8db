import { describe, expect, test } from "bun:test";
import { normalizeManifest, verifyRelease } from "../.github/scripts/verify-release.mjs";

function release() {
  const files = {
    "darwin-aarch64": "l8db.app.tar.gz",
    "darwin-x86_64": "l8db.app.tar.gz",
    "linux-x86_64": "l8db.AppImage",
    "windows-x86_64": "l8db-setup.exe",
  };
  return {
    manifest: {
      version: "0.3.0",
      platforms: Object.fromEntries(
        Object.entries(files).map(([platform, name]) => [
          platform,
          {
            url: `https://github.com/Leon-Achteresch/l8db/releases/download/v0.3.0/${name}`,
            signature: "signed",
          },
        ]),
      ),
    },
    assets: [
      "latest.json",
      ...new Set(Object.values(files).flatMap((name) => [name, `${name}.sig`])),
    ].map((name) => ({ name })),
  };
}

describe("release publication gate", () => {
  test("accepts complete universal Mac, Linux and Windows artifacts", () => {
    const { manifest, assets } = release();
    expect(() => verifyRelease(manifest, assets, "0.3.0")).not.toThrow();
  });
  test("rejects a partial platform build", () => {
    const { manifest, assets } = release();
    delete manifest.platforms["windows-x86_64"];
    expect(() => verifyRelease(manifest, assets, "0.3.0")).toThrow("Missing updater platform");
  });
  test("rejects missing installers and detached signatures", () => {
    const { manifest, assets } = release();
    for (const name of ["l8db.AppImage", "l8db.AppImage.sig"]) {
      expect(() =>
        verifyRelease(
          manifest,
          assets.filter((asset) => asset.name !== name),
          "0.3.0",
        ),
      ).toThrow();
    }
  });
  test("rejects stale versions, external URLs and empty signatures", () => {
    const { manifest, assets } = release();
    expect(() => verifyRelease(manifest, assets, "0.4.0")).toThrow();
    manifest.platforms["windows-x86_64"].url = "https://example.com/installer.exe";
    expect(() => verifyRelease(manifest, assets, "0.3.0")).toThrow();
    const clean = release();
    clean.manifest.platforms["linux-x86_64"].signature = "";
    expect(() => verifyRelease(clean.manifest, clean.assets, "0.3.0")).toThrow();
  });
  test("rewrites draft asset API urls to public download urls", () => {
    const { manifest, assets } = release();
    const withIds = assets.map((asset, index) => ({
      ...asset,
      apiUrl: `https://api.github.com/repos/Leon-Achteresch/l8db/releases/assets/${index}`,
    }));
    for (const [platform, entry] of Object.entries(manifest.platforms)) {
      const index = withIds.findIndex((asset) => asset.name === entry.url.split("/").at(-1));
      manifest.platforms[platform].url = withIds[index].apiUrl;
    }
    normalizeManifest(manifest, withIds, "0.3.0");
    expect(() => verifyRelease(manifest, withIds, "0.3.0")).not.toThrow();
    expect(manifest.platforms["windows-x86_64"].url).toBe(
      "https://github.com/Leon-Achteresch/l8db/releases/download/v0.3.0/l8db-setup.exe",
    );
  });
});
