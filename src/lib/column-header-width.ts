export const COLUMN_SIZE_MIN = 80;
export const COLUMN_SIZE_MAX = 850;
export const HEADER_FIT_CHROME = 84;
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

const MONO_FONT =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
const TYPE_BADGE_CHROME = 24;

export function measureHeaderTitleWidth(title: string, typeLabel = ""): number {
  const badge = typeLabel ? TYPE_BADGE_CHROME + typeLabel.length * 0.45 : 0;
  if (typeof document === "undefined") return title.length * 7.2 + typeLabel.length * 5.9 + badge;
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return title.length * 7.2 + typeLabel.length * 5.9 + badge;
  context.font = `600 12px ${MONO_FONT}`;
  const titleWidth = context.measureText(title).width;
  context.font = `600 9px ${MONO_FONT}`;
  return titleWidth + context.measureText(typeLabel.toUpperCase()).width + badge;
}
