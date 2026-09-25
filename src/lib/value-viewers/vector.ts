import { decodeBinaryValue } from "./binary";

export type ParsedVector = {
  values: Float64Array;
  dims: number;
  sparse: boolean;
  nonZero: number;
  source: "text" | "array" | "float32";
};

export type VectorStats = {
  norm: number;
  min: number;
  max: number;
  mean: number;
  nonZero: number;
};

const VECTOR_TYPE = /^(?:vector|halfvec|sparsevec)\b|^array\(float(?:32|64)\)/;
const SPARSE = /^\{([^}]*)\}\/(\d+)$/;
const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$|^[-+]?(?:NaN|Infinity|inf)$/i;

export function isVectorDataType(dataType?: string | null): boolean {
  if (!dataType) return false;
  const lower = dataType.toLowerCase().trim();
  return VECTOR_TYPE.test(lower);
}

function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!NUMBER.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  if (lower.endsWith("inf")) return lower.startsWith("-") ? -Infinity : Infinity;
  return Number(trimmed);
}

function finish(values: Float64Array, sparse: boolean, source: ParsedVector["source"]) {
  let nonZero = 0;
  for (const v of values) if (v !== 0) nonZero++;
  return { values, dims: values.length, sparse, nonZero, source };
}

function parseSparse(text: string): ParsedVector | null {
  const match = SPARSE.exec(text);
  if (!match) return null;
  const dims = Number(match[2]);
  if (!Number.isSafeInteger(dims) || dims > 10_000_000) return null;
  const values = new Float64Array(dims);
  if (match[1].trim()) {
    for (const part of match[1].split(",")) {
      const [indexText, valueText] = part.split(":");
      const index = Number(indexText);
      const value = parseNumber(valueText ?? "");
      if (!Number.isInteger(index) || index < 1 || index > dims || value === null) return null;
      values[index - 1] = value;
    }
  }
  return finish(values, true, "text");
}

export function parseVectorText(text: string): ParsedVector | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return parseSparse(trimmed);
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return finish(new Float64Array(0), false, "text");
  const parts = body.split(",");
  const values = new Float64Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    const value = parseNumber(parts[i]);
    if (value === null) return null;
    values[i] = value;
  }
  return finish(values, false, "text");
}

export function float32Vector(bytes: Uint8Array): ParsedVector | null {
  if (bytes.length < 8 || bytes.length % 4 !== 0) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = new Float64Array(bytes.length / 4);
  for (let i = 0; i < values.length; i++) values[i] = view.getFloat32(i * 4, true);
  return finish(values, false, "float32");
}

export function parseVectorValue(value: unknown, dataType?: string | null): ParsedVector | null {
  if (Array.isArray(value)) {
    if (!value.every((v) => typeof v === "number")) return null;
    return finish(Float64Array.from(value as number[]), false, "array");
  }
  if (typeof value !== "string") return null;
  const text = parseVectorText(value);
  if (text) return text;
  const binary = decodeBinaryValue(value, dataType);
  if (binary) return float32Vector(binary.bytes);
  if (isVectorDataType(dataType) && value.length >= 8 && value.length % 4 === 0) {
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code > 0xff) return null;
      bytes[i] = code;
    }
    return float32Vector(bytes);
  }
  return null;
}

export function vectorStats(values: Float64Array): VectorStats {
  let sum = 0;
  let squares = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  let nonZero = 0;
  for (const v of values) {
    sum += v;
    squares += v * v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v !== 0) nonZero++;
  }
  const n = values.length;
  return {
    norm: Math.sqrt(squares),
    min: n ? min : 0,
    max: n ? max : 0,
    mean: n ? sum / n : 0,
    nonZero,
  };
}

export function vectorHistogram(values: Float64Array, buckets = 24): number[] {
  const out = new Array<number>(buckets).fill(0);
  if (!values.length) return out;
  const { min, max } = vectorStats(values);
  const span = max - min;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    const index = span === 0 ? 0 : Math.min(buckets - 1, Math.floor(((v - min) / span) * buckets));
    out[index]++;
  }
  return out;
}

export function looksLikeVectorText(value: string): boolean {
  if (value.length < 3) return false;
  const first = value.charCodeAt(0);
  const last = value.charCodeAt(value.length - 1);
  if (first === 91 && last === 93) {
    const head = value.slice(1, Math.min(48, value.length - 1));
    return /^\s*[-+.\d]/.test(head) && /^[-+.\deE,\s]*$/.test(head);
  }
  if (first === 123)
    return /^\{\s*(?:\d+:|\})/.test(value.slice(0, 16)) && /\}\/\d+$/.test(value.slice(-16));
  return false;
}

function shortNumber(text: string): string {
  const value = Number(text);
  if (!Number.isFinite(value)) return text.trim();
  if (Number.isInteger(value)) return String(value);
  return String(Number(value.toPrecision(3)));
}

export function compactVectorPreview(value: string, head = 3): string {
  const sparse = value.charCodeAt(0) === 123;
  if (sparse) {
    const slash = value.lastIndexOf("/");
    const dims = value.slice(slash + 1);
    const body = value.slice(1, value.lastIndexOf("}"));
    const entries = body ? body.split(",", head + 1) : [];
    let count = 0;
    if (body) {
      count = 1;
      for (let i = body.indexOf(","); i !== -1; i = body.indexOf(",", i + 1)) count++;
    }
    const shown = entries
      .slice(0, head)
      .map((entry) => {
        const [index, v] = entry.split(":");
        return `${index.trim()}:${shortNumber(v ?? "")}`;
      })
      .join(", ");
    return `{${shown}${count > head ? ", …" : ""}} (${dims}d, ${count} ≠0)`;
  }
  const end = value.length - 1;
  let dims = 0;
  const parts: string[] = [];
  let start = 1;
  if (value.slice(1, end).trim()) {
    for (let i = 1; i <= end; i++) {
      const code = value.charCodeAt(i);
      if (code === 44 || i === end) {
        if (parts.length < head) parts.push(shortNumber(value.slice(start, i)));
        dims++;
        start = i + 1;
      }
    }
  }
  return `[${parts.join(", ")}${dims > head ? ", …" : ""}] (${dims}d)`;
}
