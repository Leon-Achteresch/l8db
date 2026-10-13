export type AiRichBlock = (
  | {
      type: "tool";
      id: string;
      name: string;
      status: string;
      output: string;
      sql?: string;
      title?: string;
      chart?: { chart: string; x?: string; y?: string[] };
    }
  | {
      type: "plan";
      id: string;
      items: {
        id: string;
        title: string;
        status: "pending" | "in-progress" | "completed" | "cancelled";
      }[];
    }
  | { type: "diff"; id: string; path: string; diff: string }
  | { type: "citation"; id: string; title: string; url?: string; description?: string }
  | {
      type: "image";
      id: string;
      src?: string;
      label: string;
      status: "generating" | "complete" | "error";
    }
  | { type: "decision"; id: string; title: string; outcome: "allowed" | "denied" | "answered" }
) & { at?: number };

export const text = (value: unknown, limit = 16000) =>
  typeof value === "string"
    ? value
        .slice(0, limit)
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
        .replace(
          /((?:authorization|api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
          "$1[redacted]",
        )
    : "";
export const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 80) : []);
export const safeUrl = (value: unknown) => {
  try {
    const url = new URL(text(value, 2000));
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
};
const CHART_KINDS = ["column", "bars", "line", "area", "donut", "kpi", "scatter", "table"];
export function toolDetails(value: unknown, name: string) {
  const args = record(value);
  const sql = text(args.sql, 8000).trim();
  const title = text(args.title, 300).trim();
  const kind = text(args.chart, 40);
  const y = list(args.y)
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, 8)
    .map((entry) => text(entry, 200));
  return {
    ...(sql ? { sql } : {}),
    ...(title ? { title } : {}),
    ...(name === "visualize" && CHART_KINDS.includes(kind)
      ? {
          chart: {
            chart: kind,
            ...(typeof args.x === "string" ? { x: text(args.x, 200) } : {}),
            ...(y.length ? { y } : {}),
          },
        }
      : {}),
  };
}
export function aiRaster(value: unknown, mime = "image/png") {
  if (typeof value !== "string" || value.length > 2_000_000) return undefined;
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mime)) return undefined;
  const prefix = `data:${mime};base64,`;
  const payload = value.startsWith("data:") ? value.slice(prefix.length) : value;
  if (
    (value.startsWith("data:") && !value.startsWith(prefix)) ||
    payload.length < 20 ||
    payload.length % 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)
  )
    return undefined;
  try {
    const bytes = atob(payload);
    if (btoa(bytes) !== payload) return undefined;
    const valid =
      mime === "image/png"
        ? bytes.startsWith("\x89PNG\r\n\x1a\n")
        : mime === "image/jpeg"
          ? bytes.startsWith("\xff\xd8\xff")
          : mime === "image/gif"
            ? /^GIF8[79]a/.test(bytes)
            : bytes.startsWith("RIFF") && bytes.slice(8, 12) === "WEBP";
    return valid ? prefix + payload : undefined;
  } catch {
    return undefined;
  }
}
export function mergeAiRich(
  previous: AiRichBlock[] = [],
  next: AiRichBlock[],
  at?: number,
): AiRichBlock[] {
  const merged = new Map(previous.map((block) => [block.id, block]));
  for (const block of next) {
    const old = merged.get(block.id);
    const position = { at: old ? old.at : (block.at ?? at) };
    merged.set(
      block.id,
      block.type === "tool" && old?.type === "tool"
        ? {
            ...block,
            ...position,
            name: block.name === "Tool" ? old.name : block.name,
            status: block.status || old.status,
            output: block.output || old.output,
            sql: block.sql ?? old.sql,
            title: block.title ?? old.title,
            chart: block.chart ?? old.chart,
          }
        : { ...block, ...position },
    );
  }
  let imageBytes = 0;
  return [...merged.values()].slice(-80).map((block) => {
    if (block.type !== "image" || !block.src) return block;
    imageBytes += block.src.length;
    return imageBytes <= 2_000_000 ? block : { ...block, src: undefined };
  });
}
export function sanitizeAiRich(value: unknown): AiRichBlock[] {
  const blocks: AiRichBlock[] = [];
  for (const raw of list(value)) {
    const block = record(raw);
    const id = text(block.id, 200);
    if (!id) continue;
    const start = blocks.length;
    if (block.type === "tool")
      blocks.push({
        type: "tool",
        id,
        name: text(block.name, 300),
        status: ["running", "success", "error", "cancelled"].includes(String(block.status))
          ? String(block.status)
          : "cancelled",
        output: text(block.output),
        ...toolDetails(
          { sql: block.sql, title: block.title, ...record(block.chart) },
          record(block.chart).chart ? "visualize" : "",
        ),
      });
    if (block.type === "diff")
      blocks.push({
        type: "diff",
        id,
        path: text(block.path, 1000),
        diff: text(block.diff, 64000),
      });
    if (block.type === "citation")
      blocks.push({
        type: "citation",
        id,
        title: text(block.title, 300),
        url: safeUrl(block.url),
        description: text(block.description, 1000) || undefined,
      });
    if (block.type === "image") {
      const mime =
        typeof block.src === "string"
          ? block.src.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,/)?.[1]
          : undefined;
      const src = mime ? aiRaster(block.src, mime) : undefined;
      blocks.push({
        type: "image",
        id,
        label: text(block.label, 1000),
        src,
        status: src ? "complete" : block.status === "generating" ? "generating" : "error",
      });
    }
    if (block.type === "plan")
      blocks.push({
        type: "plan",
        id,
        items: list(block.items)
          .map((raw, index) => {
            const item = record(raw);
            return {
              id: String(index),
              title: text(item.title, 1000),
              status: ["pending", "in-progress", "completed", "cancelled"].includes(
                String(item.status),
              )
                ? (item.status as "pending" | "in-progress" | "completed" | "cancelled")
                : ("pending" as const),
            };
          })
          .filter((item) => item.title),
      });
    if (
      block.type === "decision" &&
      ["allowed", "denied", "answered"].includes(String(block.outcome))
    )
      blocks.push({
        type: "decision",
        id,
        title: text(block.title, 300),
        outcome: block.outcome as "allowed" | "denied" | "answered",
      });
    if (typeof block.at === "number" && Number.isInteger(block.at) && block.at >= 0)
      for (const added of blocks.slice(start)) added.at = block.at;
  }
  return mergeAiRich([], blocks);
}
