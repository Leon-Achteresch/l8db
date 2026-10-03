export type CellEditorKind = "text" | "json";

export type CellDraft = {
  text: string;
  isNull: boolean;
};

export type CellDraftValidation = { ok: true } | { ok: false; error: string };

const JSON_TYPE_PATTERN = /json/i;
const TEXT_EDITOR_TYPE_PATTERN = /^(?:vector|halfvec|sparsevec|geometry|geography)\b/i;
const LONG_TEXT_THRESHOLD = 50;

export function valueToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

export function valueToUpdateText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function toCellDraft(value: unknown, kind: CellEditorKind = "text"): CellDraft {
  if (value === null || value === undefined) return { text: "", isNull: true };
  const text = valueToText(value);
  if (kind !== "json") return { text, isNull: false };
  return { text: formatJsonDraft(text) ?? text, isNull: false };
}

export function detectCellEditorKind(value: unknown, dataType?: string | null): CellEditorKind {
  if (dataType && JSON_TYPE_PATTERN.test(dataType)) return "json";
  if (dataType && TEXT_EDITOR_TYPE_PATTERN.test(dataType)) return "text";
  if (typeof value === "object" && value !== null) return "json";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        JSON.parse(trimmed);
        return "json";
      } catch {
        return "text";
      }
    }
  }
  return "text";
}

export function isLargeCellValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "object") return true;
  if (typeof value !== "string") return false;
  return value.length > LONG_TEXT_THRESHOLD || value.includes("\n");
}

export function validateCellDraft(draft: CellDraft, kind: CellEditorKind): CellDraftValidation {
  if (draft.isNull) return { ok: true };
  if (kind !== "json") return { ok: true };
  if (draft.text.trim() === "") {
    return { ok: false, error: "Leerer Text ist kein gültiges JSON." };
  }
  try {
    JSON.parse(draft.text);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

const JSON_WHITESPACE = new Set([" ", "\t", "\n", "\r"]);

function reformatJson(text: string, indent: number): string | null {
  try {
    JSON.parse(text);
  } catch {
    return null;
  }
  let out = "";
  let depth = 0;
  let index = 0;
  const newline = () => (indent ? `\n${" ".repeat(indent * depth)}` : "");
  while (index < text.length) {
    const char = text[index];
    if (char === '"') {
      let end = index + 1;
      while (text[end] !== '"') end += text[end] === "\\" ? 2 : 1;
      out += text.slice(index, end + 1);
      index = end + 1;
    } else if (JSON_WHITESPACE.has(char)) {
      index++;
    } else if (char === "{" || char === "[") {
      let next = index + 1;
      while (JSON_WHITESPACE.has(text[next])) next++;
      if (text[next] === "}" || text[next] === "]") {
        out += char + text[next];
        index = next + 1;
      } else {
        depth++;
        out += char + newline();
        index++;
      }
    } else if (char === "}" || char === "]") {
      depth--;
      out += newline() + char;
      index++;
    } else if (char === ",") {
      out += `,${newline()}`;
      index++;
    } else if (char === ":") {
      out += indent ? ": " : ":";
      index++;
    } else {
      out += char;
      index++;
    }
  }
  return out;
}

export function formatJsonDraft(text: string): string | null {
  return reformatJson(text, 2);
}

export function cellDraftToUpdate(draft: CellDraft): string | null {
  if (draft.isNull) return null;
  return draft.text;
}

function canonical(text: string | null, kind: CellEditorKind): string | null {
  if (text === null) return null;
  if (kind !== "json") return text;
  return reformatJson(text, 0) ?? text;
}

export function isCellDraftDirty(
  original: unknown,
  draft: CellDraft,
  kind: CellEditorKind = "text",
): boolean {
  const before = canonical(valueToUpdateText(original), kind);
  const after = canonical(cellDraftToUpdate(draft), kind);
  return before !== after;
}

export function describeCellDraft(draft: CellDraft): string {
  if (draft.isNull) return "NULL";
  if (draft.text === "") return "Leerer Text";
  const lines = draft.text.split("\n").length;
  return `${draft.text.length} Zeichen · ${lines} ${lines === 1 ? "Zeile" : "Zeilen"}`;
}

export function buildRowUpdates(
  columnNames: string[],
  originalValues: Record<string, unknown>,
  columnId: string,
  next: string | null,
): Record<string, string | null> {
  const updates: Record<string, string | null> = {};
  for (const col of columnNames) {
    if (col === columnId) {
      updates[col] = next;
    } else {
      updates[col] = valueToUpdateText(originalValues[col]);
    }
  }
  return updates;
}
