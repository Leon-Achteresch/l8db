import { describe, expect, test } from "bun:test";
import {
  platformArtifacts,
  publicAssetUrl,
  requiredArtifacts,
} from "../.github/scripts/release-artifacts.mjs";
import { normalizeManifest, verifyRelease } from "../.github/scripts/verify-release.mjs";

function release() {
  const files = platformArtifacts("0.3.0");
  return {
    manifest: {
      version: "0.3.0",
      platforms: Object.fromEntries(
        Object.entries(files).map(([platform, name]) => [
          platform,
          {
            url: publicAssetUrl("0.3.0", name),
            signature: "signed",
          },
        ]),
      ),
    },
    assets: ["latest.json", ...requiredArtifacts("0.3.0")].map((name) => ({ name, size: 100 })),
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
    for (const name of ["l8db_0.3.0_amd64.AppImage", "l8db_0.3.0_amd64.AppImage.sig"]) {
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
      "https://github.com/Leon-Achteresch/l8db/releases/download/v0.3.0/l8db_0.3.0_x64-setup.exe",
    );
  });
  test("rejects empty assets, duplicate names and cross-platform installers", () => {
    const { manifest, assets } = release();
    expect(() =>
      verifyRelease(
        manifest,
        assets.map((asset) => ({ ...asset, size: 0 })),
        "0.3.0",
      ),
    ).toThrow("Empty release asset");
    expect(() => verifyRelease(manifest, [...assets, assets[0]], "0.3.0")).toThrow(
      "Duplicate release asset",
    );
    manifest.platforms["darwin-aarch64"].url = manifest.platforms["windows-x86_64"].url;
    expect(() => verifyRelease(manifest, assets, "0.3.0")).toThrow("architecture");
  });
  test("requires direct-download packages as well as updater packages", () => {
    const { manifest, assets } = release();
    for (const extension of [".dmg", ".msi", ".deb", ".rpm"]) {
      expect(() =>
        verifyRelease(
          manifest,
          assets.filter((asset) => !asset.name.endsWith(extension)),
          "0.3.0",
        ),
      ).toThrow("Missing release artifact");
    }
  });
});
