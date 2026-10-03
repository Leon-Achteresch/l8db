import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { createReadStream } from "node:fs";

function decode(value, size, label) {
  assert(typeof value === "string" && /^[A-Za-z0-9+/]+={0,2}$/.test(value), `Invalid ${label}`);
  const bytes = Buffer.from(value, "base64");
  assert.equal(bytes.toString("base64"), value, `Invalid ${label} encoding`);
  if (size) assert.equal(bytes.length, size, `Invalid ${label} size`);
  return bytes;
}

export function readSignature(encoded, publicKey) {
  const keyLines = decode(publicKey, 0, "public key").toString("utf8").trim().split(/\r?\n/);
  assert.equal(keyLines.length, 2, "Invalid public key document");
  assert(keyLines[0].startsWith("untrusted comment: "), "Invalid public key comment");
  const key = decode(keyLines[1], 42, "public key packet");
  assert.equal(key.subarray(0, 2).toString(), "Ed", "Invalid public key algorithm");
  const lines = decode(encoded.trim(), 0, "signature").toString("utf8").trim().split(/\r?\n/);
  assert.equal(lines.length, 4, "Invalid signature document");
  assert(lines[0].startsWith("untrusted comment: "), "Invalid signature comment");
  assert(lines[2].startsWith("trusted comment: "), "Invalid trusted comment");
  const packet = decode(lines[1], 74, "signature packet");
  const algorithm = packet.subarray(0, 2).toString();
  assert(["Ed", "ED"].includes(algorithm), "Invalid signature algorithm");
  assert(packet.subarray(2, 10).equals(key.subarray(2, 10)), "Updater signing key mismatch");
  const verifier = createPublicKey({
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10)]),
    format: "der",
    type: "spki",
  });
  const signature = packet.subarray(10);
  const comment = Buffer.from(lines[2].slice("trusted comment: ".length));
  assert(
    verify(
      null,
      Buffer.concat([signature, comment]),
      verifier,
      decode(lines[3], 64, "global signature"),
    ),
    "Invalid trusted comment signature",
  );
  return { verifier, signature, prehashed: algorithm === "ED" };
}

export async function verifySignedFile(file, encoded, publicKey) {
  const parsed = readSignature(encoded, publicKey);
  const sha256 = createHash("sha256");
  const prehash = parsed.prehashed ? createHash("blake2b512") : null;
  const chunks = [];
  let size = 0;
  for await (const chunk of createReadStream(file)) {
    size += chunk.length;
    sha256.update(chunk);
    if (prehash) prehash.update(chunk);
    else chunks.push(chunk);
  }
  assert(size > 0, `Empty release artifact: ${file}`);
  assert(
    verify(
      null,
      prehash ? prehash.digest() : Buffer.concat(chunks),
      parsed.verifier,
      parsed.signature,
    ),
    `Invalid updater signature: ${file}`,
  );
  return { size, sha256: sha256.digest("hex") };
}
