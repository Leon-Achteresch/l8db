const HEX = "0123456789abcdef";
const HEX_BODY = /^[0-9a-fA-F]*$/;
const BASE64_BODY = /^[A-Za-z0-9+/]*={0,2}$/;
const BINARY_TYPE = /bytea|blob|binary|image|raw|bindata|bytes/;
const NOT_BINARY_TYPE = /^binary_(?:float|double)|char|text/;

export type BinarySource = "hex" | "bindata" | "data-url" | "base64";

export type DecodedBinary = {
  bytes: Uint8Array;
  source: BinarySource;
  subType?: string;
  mime?: string;
};

export function isBinaryDataType(dataType?: string | null): boolean {
  if (!dataType) return false;
  const lower = dataType.toLowerCase().trim();
  return BINARY_TYPE.test(lower) && !NOT_BINARY_TYPE.test(lower);
}

export function isHexBlobText(value: unknown): boolean {
  return (
    typeof value === "string" && value.length >= 2 && value.charCodeAt(0) === 92 && value[1] === "x"
  );
}

export function hexBlobByteLength(value: string): number {
  return Math.floor((value.length - 2) / 2);
}

export function hexToBytes(hex: string): Uint8Array | null {
  const body =
    hex.startsWith("\\x") || hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
  if (body.length % 2 !== 0 || !HEX_BODY.test(body)) return null;
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.substr(i * 2, 2), 16);
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array, separator = ""): string {
  const parts = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    parts[i] = HEX[b >> 4] + HEX[b & 15];
  }
  return parts.join(separator);
}

export function bytesToHexLiteral(bytes: Uint8Array): string {
  return `\\x${bytesToHex(bytes)}`;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(out);
}

export function base64ToBytes(text: string): Uint8Array | null {
  const clean = text.replace(/\s+/g, "");
  if (clean.length % 4 !== 0 || !BASE64_BODY.test(clean)) return null;
  try {
    const raw = atob(clean);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

function mongoBinary(value: object): DecodedBinary | null {
  const binary = (value as { $binary?: unknown }).$binary;
  if (!binary || typeof binary !== "object") return null;
  const { base64, subType } = binary as { base64?: unknown; subType?: unknown };
  if (typeof base64 !== "string") return null;
  const bytes = base64ToBytes(base64);
  if (!bytes) return null;
  return { bytes, source: "bindata", subType: typeof subType === "string" ? subType : undefined };
}

function dataUrl(value: string): DecodedBinary | null {
  const match = /^data:([^;,]*)(;[^,]*)?,/.exec(value);
  if (!match) return null;
  const payload = value.slice(match[0].length);
  if (match[2]?.includes(";base64")) {
    const bytes = base64ToBytes(payload);
    return bytes ? { bytes, source: "data-url", mime: match[1] || undefined } : null;
  }
  try {
    const bytes = new TextEncoder().encode(decodeURIComponent(payload));
    return { bytes, source: "data-url", mime: match[1] || undefined };
  } catch {
    return null;
  }
}

export function decodeBinaryValue(value: unknown, dataType?: string | null): DecodedBinary | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return mongoBinary(value);
  if (typeof value !== "string") return null;
  if (isHexBlobText(value)) {
    const bytes = hexToBytes(value);
    return bytes ? { bytes, source: "hex" } : null;
  }
  if (value.startsWith("data:")) return dataUrl(value);
  if (!isBinaryDataType(dataType)) return null;
  if (/^0x/i.test(value)) {
    const bytes = hexToBytes(value);
    if (bytes) return { bytes, source: "hex" };
  }
  const bytes = base64ToBytes(value);
  return bytes ? { bytes, source: "base64" } : null;
}

export type HexDumpLine = { offset: string; hex: string; ascii: string };

export function hexDumpLine(bytes: Uint8Array, offset: number, width = 16): HexDumpLine {
  const end = Math.min(bytes.length, offset + width);
  let hex = "";
  let ascii = "";
  for (let i = offset; i < offset + width; i++) {
    if (i > offset) hex += i - offset === width / 2 ? "  " : " ";
    if (i < end) {
      const b = bytes[i];
      hex += HEX[b >> 4] + HEX[b & 15];
      ascii += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ".";
    } else {
      hex += "  ";
    }
  }
  return { offset: offset.toString(16).padStart(8, "0"), hex, ascii };
}

export function hexDump(bytes: Uint8Array, maxLines = Number.POSITIVE_INFINITY, width = 16) {
  const lines: HexDumpLine[] = [];
  for (let offset = 0; offset < bytes.length && lines.length < maxLines; offset += width) {
    lines.push(hexDumpLine(bytes, offset, width));
  }
  return lines;
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${units[unit]}`;
}
