export type CellEditorKind = "text" | "json";

export type CellDraft = {
  text: string;
  isNull: boolean;
};

export type CellDraftValidation = { ok: true } | { ok: false; error: string };

const JSON_TYPE_PATTERN = /json/i;
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

export function formatJsonDraft(text: string): string | null {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return null;
  }
}

export function cellDraftToUpdate(draft: CellDraft): string | null {
  if (draft.isNull) return null;
  return draft.text;
}

function canonical(text: string | null, kind: CellEditorKind): string | null {
  if (text === null) return null;
  if (kind !== "json") return text;
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text;
  }
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
