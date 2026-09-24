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

function textWidth(text: string, font: string, fallback: number): number {
  if (ASCII.test(text)) return fallback;
  const key = `${font}|${text}`;
  const cached = measured.get(key);
  if (cached !== undefined) return cached;
  if (measureContext === undefined)
    measureContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measureContext) return fallback;
  if (measureFont !== font) {
    measureContext.font = font;
    measureFont = font;
  }
  const width = measureContext.measureText(text).width;
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
