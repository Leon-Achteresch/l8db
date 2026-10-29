import { hexToBytes } from "@/lib/value-viewers/binary";

const DBEAVER_KEY_HEX = "babb4a9f774ab853c96c2d653dfe544a";

const NAVICAT_KEY = "libcckeylibcckey";

const NAVICAT_IV = "libcciv libcciv ";

const AES_BLOCK = 16;

const MAX_PASSWORD_HEX = 4096;

const encoder = new TextEncoder();

const strictDecoder = new TextDecoder("utf-8", { fatal: true });

function cryptoApi(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto ist in dieser Umgebung nicht verfügbar.");
  return subtle;
}

const keys = new Map<string, Promise<CryptoKey>>();

function aesKey(raw: Uint8Array): Promise<CryptoKey> {
  const id = Array.from(raw, (byte) => byte.toString(16).padStart(2, "0")).join("");
  let key = keys.get(id);
  if (!key) {
    key = cryptoApi().importKey("raw", raw as BufferSource, { name: "AES-CBC" }, false, [
      "decrypt",
    ]);
    keys.set(id, key);
  }
  return key;
}

async function aesCbcDecrypt(
  rawKey: Uint8Array,
  iv: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array | null> {
  if (data.length === 0 || data.length % AES_BLOCK !== 0) return null;
  try {
    const key = await aesKey(rawKey);
    const plain = await cryptoApi().decrypt(
      { name: "AES-CBC", iv: iv as BufferSource },
      key,
      data as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

function decodeText(bytes: Uint8Array): string | null {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return null;
  }
}

export async function decryptDbeaverCredentials(
  file: Uint8Array,
): Promise<Record<string, unknown> | null> {
  if (file.length <= AES_BLOCK) return null;
  const plain = await aesCbcDecrypt(
    hexToBytes(DBEAVER_KEY_HEX) as Uint8Array,
    file.slice(0, AES_BLOCK),
    file.slice(AES_BLOCK),
  );
  if (!plain) return null;
  const text = decodeText(plain);
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function printable(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return false;
  }
  return true;
}

let navicatCipher: Promise<{ key: CryptoKey; tail: Uint8Array }> | undefined;

function navicatKey() {
  navicatCipher ??= (async () => {
    const key = await cryptoApi().importKey(
      "raw",
      encoder.encode(NAVICAT_KEY) as BufferSource,
      { name: "AES-CBC" },
      false,
      ["encrypt", "decrypt"],
    );
    const padding = new Uint8Array(AES_BLOCK).fill(AES_BLOCK);
    const sealed = await cryptoApi().encrypt(
      { name: "AES-CBC", iv: new Uint8Array(AES_BLOCK) as BufferSource },
      key,
      padding as BufferSource,
    );
    return { key, tail: new Uint8Array(sealed, 0, AES_BLOCK) };
  })();
  return navicatCipher;
}

export async function decryptNavicatPasswords(values: string[]): Promise<(string | null)[]> {
  const ciphers = values.map((value) => {
    if (value.length > MAX_PASSWORD_HEX) return null;
    const bytes = hexToBytes(value.trim());
    return bytes?.length && bytes.length % AES_BLOCK === 0 ? bytes : null;
  });
  const valid = ciphers.filter((bytes) => bytes !== null);
  if (!valid.length) return values.map(() => null);
  const iv = encoder.encode(NAVICAT_IV);
  let plain: Uint8Array;
  try {
    const { key, tail } = await navicatKey();
    const joined = new Uint8Array(
      valid.reduce((sum, bytes) => sum + bytes.length, 0) + 2 * AES_BLOCK,
    );
    let offset = 0;
    for (const bytes of valid) {
      joined.set(bytes, offset);
      offset += bytes.length;
    }
    joined.set(tail, offset + AES_BLOCK);
    plain = new Uint8Array(
      await cryptoApi().decrypt(
        { name: "AES-CBC", iv: iv as BufferSource },
        key,
        joined as BufferSource,
      ),
    );
  } catch {
    return values.map(() => null);
  }
  let offset = 0;
  let previous: Uint8Array = iv;
  return ciphers.map((bytes) => {
    if (!bytes) return null;
    const block = plain.subarray(offset, offset + bytes.length);
    for (let index = 0; index < AES_BLOCK; index++) block[index] ^= previous[index] ^ iv[index];
    previous = bytes.subarray(bytes.length - AES_BLOCK);
    offset += bytes.length;
    const pad = block[block.length - 1];
    if (pad < 1 || pad > AES_BLOCK || block.subarray(-pad).some((byte) => byte !== pad))
      return null;
    const text = decodeText(block.subarray(0, -pad));
    return text !== null && printable(text) ? text : null;
  });
}

export async function decryptNavicatPassword(value: string): Promise<string | null> {
  return (await decryptNavicatPasswords([value]))[0];
}
