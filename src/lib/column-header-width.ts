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
const TITLE_FONT = `600 12px ${MONO_FONT}`;
const TYPE_FONT = `600 9px ${MONO_FONT}`;

let measureContext: CanvasRenderingContext2D | null | undefined;
let measureFont = "";
const measured = new Map<string, number>();

const ASCII = /^[\x20-\x7e]*$/;

function measure(text: string, font: string, fallback: number): number {
  if (measureContext === undefined)
    measureContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureContext) return fallback;
  if (measureFont !== font) {
    measureContext.font = font;
    measureFont = font;
  }
  return measureContext.measureText(text).width;
}

function textWidth(text: string, font: string, fallback: number): number {
  if (ASCII.test(text)) return fallback;
  const key = `${font}|${text}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  const width = measure(text, font, fallback);
  measured.set(key, width);
  return width;
}

export function measureHeaderTitleWidth(title: string, typeLabel = ""): number {
  const badge = typeLabel ? TYPE_BADGE_CHROME + typeLabel.length * 0.45 : 0;
  return (
    textWidth(title, TITLE_FONT, title.length * 7.22) +
    textWidth(typeLabel.toUpperCase(), TYPE_FONT, typeLabel.length * 5.9) +
    badge
  );
}

export const AUTOSIZE_MAX = 600;
export const AUTOSIZE_SAMPLE = 500;
const CELL_FONT = `400 12px ${MONO_FONT}`;
const CELL_CHROME = 26;
const CELL_TEXT_MAX = 100;

export function autosizeColumnWidth(
  rows: Record<string, unknown>[],
  columnId: string,
  headerWidth: number,
  format: (value: unknown) => string,
): number {
  const step = Math.max(1, Math.ceil(rows.length / AUTOSIZE_SAMPLE));
  let widest = 0;
  for (let index = 0; index < rows.length; index += step) {
    const text = format(rows[index]?.[columnId]).split("\n", 1)[0].slice(0, CELL_TEXT_MAX);
    const fallback = text.length * 7.22;
    widest = Math.max(widest, ASCII.test(text) ? fallback : measure(text, CELL_FONT, fallback));
  }
  return Math.max(headerWidth, Math.min(AUTOSIZE_MAX, Math.ceil(widest + CELL_CHROME)));
}
