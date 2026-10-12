import {
  BLOCK_SIZE,
  type BlockKind,
  type DashboardPage,
  type DashboardVariable,
  GRID_COLS,
  type Widget,
  type WidgetBlock,
} from "./model";
import { pageOf } from "./pages";
import { settle } from "./shape";
import { createId } from "./sql";
import type { VariableValues } from "./variables";

export const BLOCK_LABEL: Record<BlockKind, string> = {
  text: "Text",
  image: "Bild oder Logo",
  link: "Button",
  divider: "Abschnitt",
};

export const BLOCK_HINT: Record<BlockKind, string> = {
  text: "Überschriften, Erklärungen und Listen in Markdown",
  image: "Logo, Foto oder Grafik hochladen",
  link: "Zu einer Seite oder Webadresse springen",
  divider: "Trennlinie mit optionalem Abschnittstitel",
};

export const MAX_BLOCK_TEXT = 20_000;

const DEFAULT_BLOCK: Record<BlockKind, WidgetBlock> = {
  text: {
    type: "text",
    text: "## Überschrift\nKurze Erklärung, was diese Seite zeigt.",
    variant: "plain",
  },
  image: { type: "image", fit: "contain" },
  link: { type: "link", text: "Mehr erfahren", variant: "accent", align: "left" },
  divider: { type: "divider", text: "Abschnitt" },
};

export function isBlock(widget: Pick<Widget, "block">): boolean {
  return Boolean(widget.block);
}

export function blockWidget(
  type: BlockKind,
  page: string,
  others: Widget[],
  pages: DashboardPage[],
): Widget {
  const size = BLOCK_SIZE[type];
  const siblings = others.filter((other) => pageOf(other, pages) === page);
  const bottom = siblings.reduce((max, other) => Math.max(max, other.y + other.h), 0);
  return settle(
    {
      id: createId(),
      chart: "table",
      datasetId: null,
      title: "",
      period: "all",
      page,
      block: { ...DEFAULT_BLOCK[type] },
      x: 0,
      y: bottom,
      w: Math.min(GRID_COLS, size.w),
      h: size.h,
    },
    siblings,
  );
}

const TOKEN = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export function interpolateText(
  text: string,
  variables: DashboardVariable[],
  values: VariableValues,
): string {
  if (!text.includes("{{")) return text;
  return text.replace(TOKEN, (token, name: string) => {
    const variable = variables.find((v) => v.name === name);
    if (!variable) return token;
    const value = values[name] ?? variable.defaultValue ?? "";
    return value.trim() ? value : "alle";
  });
}

export function readImageFile(file: File, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|gif|webp|svg\+xml)$/.test(file.type)) {
      reject(new Error("Erlaubt sind PNG, JPEG, GIF, WebP und SVG."));
      return;
    }
    if (file.size > maxBytes) {
      reject(new Error(`Das Bild darf höchstens ${Math.round(maxBytes / 1024)} KiB groß sein.`));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(file);
  });
}
