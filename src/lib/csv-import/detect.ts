import { CSV_DELIMITERS, type CsvCell } from "./types";

export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectDelimiter(text: string, quote = '"'): string {
  const content = stripBom(text);
  const samples: number[][] = [];
  let counts = CSV_DELIMITERS.map(() => 0);
  let recordStart = 0;
  let fieldStart = true;
  for (let i = 0; i < content.length && samples.length < 10; i += 1) {
    const char = content[i];
    if (fieldStart && char === quote) {
      let end = content.indexOf(quote, i + 1);
      while (end !== -1 && content[end + 1] === quote) {
        end = content.indexOf(quote, end + 2);
      }
      i = end === -1 ? content.length : end;
      fieldStart = false;
    } else if (char === "\n" || char === "\r") {
      if (i > recordStart) {
        samples.push(counts);
        counts = CSV_DELIMITERS.map(() => 0);
      }
      if (char === "\r" && content[i + 1] === "\n") i += 1;
      recordStart = i + 1;
      fieldStart = true;
    } else {
      const index = CSV_DELIMITERS.findIndex((candidate) => candidate === char);
      fieldStart = index !== -1;
      if (fieldStart) counts[index] += 1;
    }
  }
  if (samples.length < 10 && recordStart < content.length) samples.push(counts);
  if (samples.length === 0) return ",";
  let best = "\t";
  let bestScore = -1;
  for (const [index, delimiter] of CSV_DELIMITERS.entries()) {
    const first = samples[0][index];
    if (first === 0) continue;
    const consistent = samples.filter((sample) => sample[index] === first).length;
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
  const cells = first.map((c) => (c ?? "").trim()).filter((c) => c !== "");
  if (cells.length === 0) return false;
  if (cells.some(looksNumeric)) return false;
  return new Set(cells.map((c) => c.toLowerCase())).size === cells.length;
}
