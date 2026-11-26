import type { ObjectPreview } from "@/lib/db";
import { type PreviewKind, parseCsv, previewKind } from "@/lib/storage/s3";
import { hexDump } from "@/lib/value-viewers/binary";

const HEX_BYTES = 2048;
const TEXT_BYTES = 256 * 1024;
export const IMAGE_PREVIEW_LIMIT = 12 * 1024 * 1024;
const MAX_TEXT_BYTES = 16 * 1024 * 1024;

export function initialPreviewLimit(key: string, listedSize: number | null) {
  const kind = previewKind(key, null);
  if (kind === "image")
    return listedSize !== null && listedSize > IMAGE_PREVIEW_LIMIT
      ? HEX_BYTES
      : IMAGE_PREVIEW_LIMIT;
  return kind === "binary" || kind === "pdf" ? HEX_BYTES : TEXT_BYTES;
}

export function nextPreviewLimit(kind: PreviewKind, data: ObjectPreview, current: number) {
  if (!data.truncated || kind === "binary" || kind === "pdf") return null;
  if (kind === "image")
    return data.size <= IMAGE_PREVIEW_LIMIT && data.size > current ? data.size : null;
  const next = Math.min(data.size, MAX_TEXT_BYTES, Math.max(TEXT_BYTES, current * 8));
  return next > current ? next : null;
}

function decodeBase64(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    const lines = text.split("\n").filter((line) => line.trim());
    try {
      return lines.map((line) => JSON.stringify(JSON.parse(line))).join("\n");
    } catch {
      return text;
    }
  }
}

export function objectPreviewContent(key: string, data: ObjectPreview) {
  const kind = previewKind(key, data.content_type);
  if (kind === "image") return { kind } as const;
  if (kind === "binary" || kind === "pdf") {
    const prefix = data.data.slice(0, Math.ceil(HEX_BYTES / 3) * 4);
    const bytes = decodeBase64(prefix).subarray(0, HEX_BYTES);
    const text = hexDump(bytes)
      .map(({ offset, hex, ascii }) => `${offset}  ${hex}  ${ascii}`)
      .join("\n");
    return { kind, bytes: bytes.length, text };
  }
  const bytes = decodeBase64(data.data);
  const text = new TextDecoder().decode(bytes, { stream: data.truncated });
  if (kind === "csv") {
    const tsv =
      key.toLowerCase().endsWith(".tsv") ||
      data.content_type?.toLowerCase().startsWith("text/tab-separated-values");
    const [columns = [], ...rows] = parseCsv(text, tsv ? "\t" : ",", data.truncated);
    return { kind, bytes: bytes.length, columns, rows };
  }
  return {
    kind,
    bytes: bytes.length,
    text: kind === "json" && !data.truncated ? prettyJson(text) : text,
  };
}
