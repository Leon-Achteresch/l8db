export const TABLE_CELL_PREVIEW_LIMIT = 500;

export type TableCellPreview = {
  text: string;
  kind: "null" | "true" | "false" | "number" | "object" | "date" | "uuid" | "text";
};

export function tableCellPreview(
  value: unknown,
  limit = TABLE_CELL_PREVIEW_LIMIT,
): TableCellPreview {
  if (value === null || value === undefined) return { text: "NULL", kind: "null" };
  if (typeof value === "boolean") return { text: String(value), kind: value ? "true" : "false" };
  if (typeof value === "number") return { text: String(value), kind: "number" };
  if (typeof value === "object")
    return {
      text: Array.isArray(value) ? `[] Array(${value.length})` : "{} Object",
      kind: "object",
    };
  const raw = String(value);
  const text = truncateCellPreview(raw, limit);
  if (raw.length <= TABLE_CELL_PREVIEW_LIMIT) {
    if (
      raw.length >= 10 &&
      (raw.includes("-") || raw.includes("T") || raw.includes(":")) &&
      !Number.isNaN(Date.parse(raw))
    )
      return { text, kind: "date" };
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw))
      return { text, kind: "uuid" };
  }
  return { text, kind: "text" };
}

export function cellPreviewLimit(width: number, fontSize = 12): number {
  const contentWidth = Math.max(0, width - Math.max(24, fontSize * 2));
  return Math.max(
    1,
    Math.min(TABLE_CELL_PREVIEW_LIMIT, Math.floor(contentWidth / Math.max(1, fontSize * 0.65)) - 1),
  );
}

export function truncateCellPreview(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const last = text.charCodeAt(limit - 1);
  const end = last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
  return `${text.slice(0, end)}…`;
}
