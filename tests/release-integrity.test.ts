import { afterEach, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  artifactNames,
  generateManifest,
  verifyArtifacts,
  verifyExecutable,
} from "../.github/scripts/release-artifacts.mjs";
import { readSignature, verifySignedFile } from "../.github/scripts/release-signatures.mjs";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function temporary() {
  const directory = mkdtempSync(join(tmpdir(), "l8db-release-integrity-"));
  directories.push(directory);
  return directory;
}
function signer() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const id = Buffer.from("0123456789abcdef", "hex");
  const raw = publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const key = Buffer.from(
    `untrusted comment: test key\n${Buffer.concat([Buffer.from("Ed"), id, raw]).toString("base64")}\n`,
  ).toString("base64");
  const signature = (data: Buffer) => {
    const bytes = sign(null, createHash("blake2b512").update(data).digest(), privateKey);
    const comment = "timestamp:1\tversion:0.3.0";
    const global = sign(null, Buffer.concat([bytes, Buffer.from(comment)]), privateKey);
    return Buffer.from(
      `untrusted comment: test signature\n${Buffer.concat([Buffer.from("ED"), id, bytes]).toString("base64")}\ntrusted comment: ${comment}\n${global.toString("base64")}\n`,
    ).toString("base64");
  };
  return { key, signature };
}

function fixture() {
  const directory = temporary();
  const names = artifactNames("0.3.0");
  const { key, signature } = signer();
  const executable = Buffer.alloc(64);
  executable.writeUInt32BE(0xcafebabe, 0);
  executable.writeUInt32BE(2, 4);
  executable.writeUInt32BE(0x01000007, 8);
  executable.writeUInt32BE(0x0100000c, 28);
  const app = join(directory, "l8db.app/Contents/MacOS");
  mkdirSync(app, { recursive: true });
  writeFileSync(join(app, "l8db"), executable);
  chmodSync(join(app, "l8db"), 0o755);
  execFileSync("tar", ["-czf", join(directory, names.mac), "-C", directory, "l8db.app"]);
  rmSync(join(directory, "l8db.app"), { recursive: true });
  const image = Buffer.alloc(64);
  Buffer.from([127, 69, 76, 70, 2, 1]).copy(image);
  Buffer.from([65, 73, 2]).copy(image, 8);
  image.writeUInt16LE(62, 18);
  writeFileSync(join(directory, names.appimage), image);
  writeFileSync(join(directory, names.deb), Buffer.from("!<arch>\n"));
  writeFileSync(join(directory, names.rpm), Buffer.from("edabeedb", "hex"));
  writeFileSync(join(directory, names.msi), Buffer.from("d0cf11e0a1b11ae1", "hex"));
  const pe = Buffer.alloc(128);
  pe.write("MZ");
  pe.writeUInt32LE(64, 60);
  Buffer.from([80, 69, 0, 0]).copy(pe, 64);
  pe.writeUInt16LE(0x14c, 68);
  writeFileSync(join(directory, names.nsis), pe);
  const dmg = Buffer.alloc(512);
  dmg.write("koly");
  writeFileSync(join(directory, names.dmg), dmg);
  for (const [kind, name] of Object.entries(names)) {
    if (kind !== "dmg")
      writeFileSync(
        join(directory, `${name}.sig`),
        `${signature(readFileSync(join(directory, name)))}\n`,
      );
  }
  const manifest = generateManifest(directory, "0.3.0", "Notes");
  writeFileSync(join(directory, "latest.json"), JSON.stringify(manifest));
  const assets = readdirSync(directory).map((name) => ({
    name,
    size: statSync(join(directory, name)).size,
    digest: `sha256:${createHash("sha256")
      .update(readFileSync(join(directory, name)))
      .digest("hex")}`,
  }));
  return { directory, names, key, signature, manifest, assets };
}

describe("release artifact integrity", () => {
  test("verifies signed packages, their formats and all manifest aliases", async () => {
    const value = fixture();
    const hashes = await verifyArtifacts(
      value.manifest,
      value.assets,
      "0.3.0",
      value.directory,
      value.key,
    );
    expect(hashes.size).toBe(value.assets.length);
  });
  test("rejects corrupted bytes, signing keys and trusted comments", async () => {
    const directory = temporary();
    const file = join(directory, "artifact");
    const data = Buffer.from("test release bytes");
    writeFileSync(file, data);
    const { key, signature } = signer();
    const encoded = signature(data);
    expect((await verifySignedFile(file, encoded, key)).size).toBe(data.length);
    writeFileSync(file, "corrupted release bytes");
    await expect(verifySignedFile(file, encoded, key)).rejects.toThrow("Invalid updater signature");
    expect(() => readSignature(encoded, signer().key)).toThrow();
    const changed = Buffer.from(encoded, "base64").toString().replace("timestamp:1", "timestamp:2");
    expect(() => readSignature(Buffer.from(changed).toString("base64"), key)).toThrow(
      "trusted comment signature",
    );
  });
  test("rejects a signed file when the manifest names a different valid signature", async () => {
    const value = fixture();
    value.manifest.platforms["windows-x86_64"].signature =
      value.manifest.platforms["linux-x86_64"].signature;
    await expect(
      verifyArtifacts(value.manifest, value.assets, "0.3.0", value.directory, value.key),
    ).rejects.toThrow("Manifest signature mismatch");
  });
  test("rejects signed executables of another architecture", async () => {
    const value = fixture();
    const file = join(value.directory, value.names.appimage);
    const bytes = readFileSync(file);
    bytes.writeUInt16LE(183, 18);
    writeFileSync(file, bytes);
    writeFileSync(`${file}.sig`, value.signature(bytes));
    const assets = value.assets.map((asset) => ({
      name: asset.name,
      size: statSync(join(value.directory, asset.name)).size,
    }));
    await expect(
      verifyArtifacts(value.manifest, assets, "0.3.0", value.directory, value.key),
    ).rejects.toThrow("Wrong Linux architecture");
  });
  test("rejects an asset whose downloaded hash disagrees with GitHub", async () => {
    const value = fixture();
    value.assets[0].digest = `sha256:${"0".repeat(64)}`;
    await expect(
      verifyArtifacts(value.manifest, value.assets, "0.3.0", value.directory, value.key),
    ).rejects.toThrow("digest mismatch");
  });
  test("rejects a PE binary whose payload is not x64", () => {
    const bytes = Buffer.alloc(128);
    bytes.write("MZ");
    bytes.writeUInt32LE(64, 60);
    Buffer.from([80, 69, 0, 0]).copy(bytes, 64);
    bytes.writeUInt16LE(0x14c, 68);
    expect(() => verifyExecutable(bytes, "windows-x86_64")).toThrow("Wrong Windows architecture");
    bytes.writeUInt16LE(0x8664, 68);
    expect(() => verifyExecutable(bytes, "windows-x86_64")).not.toThrow();
  });
  test("accepts the minisign-verify upstream prehashed compatibility vector", async () => {
    const file = join(temporary(), "test");
    writeFileSync(file, "test");
    const key = Buffer.from(
      "untrusted comment: test key\nRWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n",
    ).toString("base64");
    const signature = Buffer.from(
      "untrusted comment: signature from minisign secret key\nRUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=\ntrusted comment: timestamp:1556193335\tfile:test\ny/rUw2y8/hOUYjZU71eHp/Wo1KZ40fGy2VJEDl34XMJM+TX48Ss/17u3IvIfbVR1FkZZSNCisQbuQY+bHwhEBg==\n",
    ).toString("base64");
    expect((await verifySignedFile(file, signature, key)).size).toBe(4);
  });
});
