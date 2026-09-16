export const COLUMN_SIZE_MIN = 80;
export const COLUMN_SIZE_MAX = 850;
export const HEADER_FIT_CHROME = 120;
export const HEADER_FIT_FK = 16;

export function fitHeaderColumnWidth(titleWidth: number, hasFk = false): number {
  return Math.min(
    COLUMN_SIZE_MAX,
    Math.max(
      COLUMN_SIZE_MIN,
      Math.ceil(titleWidth + HEADER_FIT_CHROME + (hasFk ? HEADER_FIT_FK : 0)),
    ),
  );
}

export function measureHeaderTitleWidth(title: string): number {
  if (typeof document === "undefined") return title.length * 7.2;
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) return title.length * 7.2;
  context.font =
    '600 12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
  return context.measureText(title).width;
}
