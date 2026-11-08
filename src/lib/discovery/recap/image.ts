import { formatDuration, type Recap } from "./model";

const WIDTH = 1080;
const HEIGHT = 1350;

function colors() {
  const probe = document.createElement("span");
  document.body.append(probe);
  const read = (name: string, fallback: string) => {
    probe.style.color = `var(${name}, ${fallback})`;
    return getComputedStyle(probe).color || fallback;
  };
  const palette = {
    background: read("--background", "#ffffff"),
    foreground: read("--foreground", "#111111"),
    muted: read("--muted-foreground", "#666666"),
    accent: read("--primary", "#3b82f6"),
  };
  probe.remove();
  return palette;
}

export function recapLines(recap: Recap, familyLabel: (kind: string) => string) {
  const lines: [string, string][] = [
    ["Abfragen", recap.queries.toLocaleString("de-DE")],
    ["Operationen", recap.operations.toLocaleString("de-DE")],
  ];
  if (recap.families.length)
    lines.push(["Datenbanken", recap.families.map((row) => familyLabel(row.kind)).join(", ")]);
  if (recap.longestMs > 0) lines.push(["Längste Operation", formatDuration(recap.longestMs)]);
  if (recap.activeMonth) lines.push(["Aktivster Monat", recap.activeMonth]);
  if (recap.activeWeekday) lines.push(["Aktivster Tag", recap.activeWeekday]);
  if (recap.topFeatures.length)
    lines.push(["Lieblingsfunktion", recap.topFeatures[0]?.title ?? ""]);
  return lines;
}

export async function renderRecapPng(
  recap: Recap,
  familyLabel: (kind: string) => string,
): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas nicht verfügbar");
  const palette = colors();
  const font = getComputedStyle(document.body).fontFamily || "sans-serif";
  context.fillStyle = palette.background;
  context.fillRect(0, 0, WIDTH, HEIGHT);
  context.fillStyle = palette.accent;
  context.fillRect(96, 120, 72, 8);
  context.fillStyle = palette.foreground;
  context.font = `700 84px ${font}`;
  context.fillText(`Mein l8db-Jahr ${recap.year}`, 96, 240, WIDTH - 192);
  let y = 380;
  for (const [label, value] of recapLines(recap, familyLabel)) {
    context.fillStyle = palette.muted;
    context.font = `500 32px ${font}`;
    context.fillText(label, 96, y, WIDTH - 192);
    context.fillStyle = palette.foreground;
    context.font = `700 56px ${font}`;
    context.fillText(value, 96, y + 64, WIDTH - 192);
    y += 132;
  }
  context.fillStyle = palette.muted;
  context.font = `500 28px ${font}`;
  context.fillText("l8db", 96, HEIGHT - 96);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("PNG konnte nicht erzeugt werden"))),
      "image/png",
    ),
  );
}

export async function saveRecapPng(
  recap: Recap,
  familyLabel: (kind: string) => string,
): Promise<string | null> {
  const png = await renderRecapPng(recap, familyLabel);
  const [{ save }, { writeFile }] = await Promise.all([
    import("@tauri-apps/plugin-dialog"),
    import("@tauri-apps/plugin-fs"),
  ]);
  const path = await save({
    defaultPath: `l8db-${recap.year}.png`,
    filters: [{ name: "PNG", extensions: ["png"] }],
  });
  if (path) await writeFile(path, new Uint8Array(await png.arrayBuffer()));
  return path;
}
