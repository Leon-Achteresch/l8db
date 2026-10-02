import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { readSignature, verifySignedFile } from "./release-signatures.mjs";
import { REPOSITORY, VERSION_PATTERN } from "./release-utils.mjs";

export function artifactNames(version) {
  assert(VERSION_PATTERN.test(version), "Invalid release version");
  return {
    mac: `l8db_${version}_universal.app.tar.gz`,
    dmg: `l8db_${version}_universal.dmg`,
    appimage: `l8db_${version}_amd64.AppImage`,
    deb: `l8db_${version}_amd64.deb`,
    rpm: `l8db-${version}-1.x86_64.rpm`,
    nsis: `l8db_${version}_x64-setup.exe`,
    msi: `l8db_${version}_x64_en-US.msi`,
  };
}

export function platformArtifacts(version) {
  const names = artifactNames(version);
  return {
    "darwin-aarch64": names.mac,
    "darwin-x86_64": names.mac,
    "darwin-aarch64-app": names.mac,
    "darwin-x86_64-app": names.mac,
    "linux-x86_64": names.appimage,
    "linux-x86_64-appimage": names.appimage,
    "linux-x86_64-deb": names.deb,
    "linux-x86_64-rpm": names.rpm,
    "windows-x86_64": names.nsis,
    "windows-x86_64-nsis": names.nsis,
    "windows-x86_64-msi": names.msi,
  };
}

export function requiredArtifacts(version) {
  const names = artifactNames(version);
  return [
    ...Object.values(names),
    ...Object.entries(names)
      .filter(([kind]) => kind !== "dmg")
      .map(([, name]) => `${name}.sig`),
  ];
}

export function publicAssetUrl(version, filename) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${encodeURIComponent(filename)}`;
}

export function verifyManifest(manifest, assets, version) {
  assert.equal(manifest.version, version, "Updater version mismatch");
  const available = new Map();
  for (const asset of assets) {
    assert(
      typeof asset.name === "string" &&
        !/[\\/\r\n]/.test(asset.name) &&
        asset.name !== "." &&
        asset.name !== "..",
      "Invalid release asset name",
    );
    assert(!available.has(asset.name), `Duplicate release asset: ${asset.name}`);
    assert(
      Number.isSafeInteger(asset.size) && asset.size > 0,
      `Empty release asset: ${asset.name}`,
    );
    available.set(asset.name, asset);
  }
  for (const filename of ["latest.json", ...requiredArtifacts(version)])
    assert(available.has(filename), `Missing release artifact: ${filename}`);
  const expected = platformArtifacts(version);
  for (const platform of ["darwin-aarch64", "darwin-x86_64", "linux-x86_64", "windows-x86_64"])
    assert(manifest.platforms?.[platform], `Missing updater platform: ${platform}`);
  for (const [platform, entry] of Object.entries(manifest.platforms ?? {})) {
    assert(expected[platform], `Unexpected updater platform: ${platform}`);
    assert.equal(
      entry.url,
      publicAssetUrl(version, expected[platform]),
      `Wrong release URL or architecture: ${platform}`,
    );
    assert(
      typeof entry.signature === "string" && entry.signature.trim().length > 0,
      `Empty update signature: ${platform}`,
    );
  }
}

export function generateManifest(directory, version, notes, date = new Date().toISOString()) {
  return {
    version,
    notes,
    pub_date: date,
    platforms: Object.fromEntries(
      Object.entries(platformArtifacts(version)).map(([platform, filename]) => [
        platform,
        {
          url: publicAssetUrl(version, filename),
          signature: readFileSync(join(directory, `${filename}.sig`), "utf8").trim(),
        },
      ]),
    ),
  };
}

function prefix(file, length = 64) {
  const descriptor = openSync(file, "r");
  try {
    const bytes = Buffer.alloc(length);
    const read = readSync(descriptor, bytes, 0, length, 0);
    return bytes.subarray(0, read);
  } finally {
    closeSync(descriptor);
  }
}

export function verifyExecutable(bytes, target) {
  if (target === "linux-x86_64") {
    assert(
      bytes.length >= 64 && bytes.subarray(0, 4).equals(Buffer.from([127, 69, 76, 70])),
      "Invalid Linux executable",
    );
    assert.equal(bytes[4], 2, "Linux executable must be 64 bit");
    assert.equal(bytes[5], 1, "Linux executable must be little endian");
    assert.equal(bytes.readUInt16LE(18), 62, "Wrong Linux architecture");
  } else if (target === "darwin-universal") {
    assert(
      bytes.length >= 48 && bytes.readUInt32BE(0) === 0xcafebabe,
      "Invalid universal macOS executable",
    );
    const count = bytes.readUInt32BE(4);
    assert(
      count === 2 && bytes.length >= 8 + count * 20,
      "Both macOS architectures must be present",
    );
    const cpus = new Set(
      Array.from({ length: count }, (_, index) => bytes.readUInt32BE(8 + index * 20)),
    );
    assert(cpus.has(0x01000007) && cpus.has(0x0100000c), "Wrong macOS architectures");
  } else if (target === "windows-x86_64") {
    assert(
      bytes.length >= 64 && bytes.subarray(0, 2).toString() === "MZ",
      "Invalid Windows executable",
    );
    const offset = bytes.readUInt32LE(60);
    assert(
      offset + 6 <= bytes.length &&
        bytes.subarray(offset, offset + 4).equals(Buffer.from([80, 69, 0, 0])),
      "Invalid Windows PE header",
    );
    assert.equal(bytes.readUInt16LE(offset + 4), 0x8664, "Wrong Windows architecture");
  } else throw new Error(`Unsupported executable target: ${target}`);
}

export function verifyArtifactFormat(file, kind) {
  const bytes = prefix(file, 4096);
  if (kind === "appimage") {
    verifyExecutable(bytes, "linux-x86_64");
    assert(bytes.subarray(8, 11).equals(Buffer.from([65, 73, 2])), "Invalid AppImage type");
  } else if (kind === "deb")
    assert.equal(bytes.subarray(0, 8).toString(), "!<arch>\n", "Invalid Debian package");
  else if (kind === "rpm")
    assert.equal(bytes.subarray(0, 4).toString("hex"), "edabeedb", "Invalid RPM package");
  else if (kind === "msi")
    assert.equal(bytes.subarray(0, 8).toString("hex"), "d0cf11e0a1b11ae1", "Invalid MSI package");
  else if (kind === "nsis") {
    assert.equal(bytes.subarray(0, 2).toString(), "MZ", "Invalid NSIS installer");
    const offset = bytes.readUInt32LE(60);
    assert(
      offset + 6 <= bytes.length &&
        bytes.subarray(offset, offset + 4).equals(Buffer.from([80, 69, 0, 0])),
      "Invalid NSIS PE header",
    );
    assert(
      [0x14c, 0x8664].includes(bytes.readUInt16LE(offset + 4)),
      "Invalid NSIS launcher architecture",
    );
  } else if (kind === "dmg") {
    const descriptor = openSync(file, "r");
    try {
      const trailer = Buffer.alloc(4);
      const size = statSync(file).size;
      assert(size >= 512, "Invalid DMG size");
      readSync(descriptor, trailer, 0, 4, size - 512);
      assert.equal(trailer.toString(), "koly", "Invalid DMG trailer");
    } finally {
      closeSync(descriptor);
    }
  } else if (kind === "mac") {
    const names = execFileSync("tar", ["-tzf", file], {
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    })
      .trim()
      .split("\n");
    assert(
      names.every((name) => !name.startsWith("/") && !name.split("/").includes("..")),
      "Unsafe macOS archive paths",
    );
    const executable = names.find((name) =>
      /^(?:\.\/)?l8db\.app\/Contents\/MacOS\/l8db$/.test(name),
    );
    assert(executable, "Missing macOS application executable");
    const binary = execFileSync("tar", ["-xOf", file, executable], {
      maxBuffer: 256 * 1024 * 1024,
    });
    verifyExecutable(binary, "darwin-universal");
  } else throw new Error(`Unsupported artifact format: ${kind}`);
}

async function fileHash(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyArtifacts(manifest, assets, version, directory, publicKey) {
  verifyManifest(manifest, assets, version);
  const hashes = new Map();
  for (const asset of assets) {
    const file = join(directory, asset.name);
    assert(statSync(file).isFile(), `Missing artifact file: ${asset.name}`);
    assert.equal(statSync(file).size, asset.size, `Artifact size mismatch: ${asset.name}`);
    const sha256 = await fileHash(file);
    if (asset.digest)
      assert.equal(asset.digest, `sha256:${sha256}`, `Artifact digest mismatch: ${asset.name}`);
    hashes.set(asset.name, sha256);
  }
  for (const [kind, filename] of Object.entries(artifactNames(version))) {
    const file = join(directory, filename);
    verifyArtifactFormat(file, kind);
    if (kind === "dmg") continue;
    const encoded = readFileSync(`${file}.sig`, "utf8").trim();
    readSignature(encoded, publicKey);
    await verifySignedFile(file, encoded, publicKey);
    for (const [platform, entry] of Object.entries(manifest.platforms)) {
      if (platformArtifacts(version)[platform] === filename)
        assert.equal(entry.signature, encoded, `Manifest signature mismatch: ${platform}`);
    }
  }
  return hashes;
}
