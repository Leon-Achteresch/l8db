import { bytesToBase64 } from "./binary";

export type ImageFormat = {
  mime: string;
  label: string;
  extension: string;
};

const PNG: ImageFormat = { mime: "image/png", label: "PNG", extension: "png" };
const JPEG: ImageFormat = { mime: "image/jpeg", label: "JPEG", extension: "jpg" };
const GIF: ImageFormat = { mime: "image/gif", label: "GIF", extension: "gif" };
const WEBP: ImageFormat = { mime: "image/webp", label: "WebP", extension: "webp" };
const BMP: ImageFormat = { mime: "image/bmp", label: "BMP", extension: "bmp" };
const SVG: ImageFormat = { mime: "image/svg+xml", label: "SVG", extension: "svg" };

function startsWith(bytes: ArrayLike<number>, signature: number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (bytes[offset + i] !== signature[i]) return false;
  }
  return true;
}

function looksLikeSvg(text: string): boolean {
  const head = text.slice(0, 512).trimStart().toLowerCase();
  if (head.startsWith("<svg")) return true;
  return (head.startsWith("<?xml") || head.startsWith("<!doctype svg")) && head.includes("<svg");
}

export function sniffImageBytes(bytes: ArrayLike<number>): ImageFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return PNG;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return JPEG;
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return GIF;
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return WEBP;
  if (startsWith(bytes, [0x42, 0x4d]) && bytes.length >= 26) return BMP;
  if (bytes.length > 4 && (bytes[0] === 0x3c || bytes[0] === 0xef || bytes[0] === 0x20)) {
    const head = new TextDecoder().decode(
      bytes instanceof Uint8Array
        ? bytes.subarray(0, 512)
        : Uint8Array.from(bytes).subarray(0, 512),
    );
    if (looksLikeSvg(head)) return SVG;
  }
  return null;
}

export function sniffImageHexPrefix(hexLiteral: string): ImageFormat | null {
  const head: number[] = [];
  for (let i = 2; i + 1 < hexLiteral.length && head.length < 16; i += 2) {
    const byte = Number.parseInt(hexLiteral.substr(i, 2), 16);
    if (Number.isNaN(byte)) return null;
    head.push(byte);
  }
  const format = sniffImageBytes(head);
  return format === SVG || format === BMP ? null : format;
}

export function sniffImageText(value: string): ImageFormat | null {
  const match = /^data:(image\/[a-z0-9.+-]+)[;,]/i.exec(value);
  if (match) {
    const mime = match[1].toLowerCase();
    return (
      [PNG, JPEG, GIF, WEBP, BMP, SVG].find((format) => format.mime === mime) ?? {
        mime,
        label: mime.slice(6).toUpperCase(),
        extension: mime.slice(6),
      }
    );
  }
  return looksLikeSvg(value) ? SVG : null;
}

export function imageDataUrl(bytes: Uint8Array, format: ImageFormat): string {
  return `data:${format.mime};base64,${bytesToBase64(bytes)}`;
}

export function svgDataUrl(text: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
}
