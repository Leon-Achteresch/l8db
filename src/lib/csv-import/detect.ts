import { CSV_DELIMITERS, type CsvCell } from "./types";

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string, quote: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === quote) {
      if (inQuotes && line[i + 1] === quote) {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count += 1;
  }
  return count;
}

function sampleLines(text: string, limit: number): string[] {
  const lines: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < text.length && lines.length < limit; i += 1) {
    const char = text[i];
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      if (current.length > 0) lines.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.length > 0 && lines.length < limit) lines.push(current);
  return lines;
}

export function detectDelimiter(text: string, quote = '"'): string {
  const lines = sampleLines(stripBom(text), 10);
  if (lines.length === 0) return ",";
  let best = ",";
  let bestScore = -1;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = lines.map((line) => countDelimiterOutsideQuotes(line, delimiter, quote));
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const consistent = counts.filter((c) => c === first).length;
    const score = first * 100 + consistent;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function looksNumeric(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed === "") return false;
  return /^[+-]?\d+([.,]\d+)?$/.test(trimmed);
}

export function detectHeader(records: CsvCell[][]): boolean {
  const first = records[0];
  if (!first || first.length === 0) return false;
  const cells = first.map((c) => c ?? "");
  if (cells.some((c) => c.trim() === "")) return false;
  if (cells.some(looksNumeric)) return false;
  const unique = new Set(cells.map((c) => c.trim().toLowerCase()));
  if (unique.size !== cells.length) return false;
  return true;
}
