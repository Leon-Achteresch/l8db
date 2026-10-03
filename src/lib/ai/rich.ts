import type { AiEvent } from "@/lib/db/ai";

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

const text = (value: unknown, limit = 16000) =>
  typeof value === "string"
    ? value
        .slice(0, limit)
        .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
        .replace(
          /((?:authorization|api[_-]?key|access[_-]?token|token|password|secret)\s*[:=]\s*)(?:Bearer\s+)?[^\s,;]+/gi,
          "$1[redacted]",
        )
    : "";
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value.slice(0, 80) : []);
const safeUrl = (value: unknown) => {
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
const status = (value: unknown) =>
  ["completed", "complete", "success"].includes(String(value))
    ? "success"
    : ["failed", "error"].includes(String(value))
      ? "error"
      : ["cancelled", "declined", "denied"].includes(String(value))
        ? ("cancelled" as const)
        : "running";
function safeOutput(value: unknown): string {
  if (typeof value === "string") return text(value);
  if (Array.isArray(value))
    return value.slice(0, 80).map(safeOutput).filter(Boolean).join("\n").slice(0, 16000);
  const obj = record(value);
  if (obj.type === "content") return safeOutput(obj.content);
  if (obj.type === "image") return "Bild-Ergebnis";
  if (typeof obj.text === "string") return text(obj.text);
  if (typeof obj.output === "string") return text(obj.output);
  if (typeof obj.aggregatedOutput === "string") return text(obj.aggregatedOutput);
  if (Array.isArray(obj.content))
    return list(obj.content).map(safeOutput).filter(Boolean).join("\n").slice(0, 16000);
  const scrub = (entry: unknown, depth = 0): unknown => {
    if (depth > 5) return "[truncated]";
    if (typeof entry === "string") return text(entry, 2000);
    if (entry === null || typeof entry === "number" || typeof entry === "boolean") return entry;
    if (Array.isArray(entry)) return list(entry).map((item) => scrub(item, depth + 1));
    return Object.fromEntries(
      Object.entries(record(entry))
        .slice(0, 80)
        .filter(
          ([key]) =>
            !/authorization|password|secret|token|api.?key|arguments|rawInput|connectionString/i.test(
              key,
            ),
        )
        .map(([key, item]) => [key, scrub(item, depth + 1)]),
    );
  };
  return Object.keys(obj).length ? JSON.stringify(scrub(obj), null, 2).slice(0, 16000) : "";
}
const CHART_KINDS = ["column", "bars", "line", "area", "donut", "kpi", "scatter", "table"];
function toolDetails(value: unknown, name: string) {
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
export function normalizeAiRich(event: AiEvent): AiRichBlock[] {
  const data = event.data;
  const id = text(data.id, 200) || `${event.kind}-result`;
  const blocks: AiRichBlock[] = [];
  if (event.kind === "metadata") {
    const plan = list(data.plan ?? (data.sessionUpdate === "plan" ? data.entries : undefined));
    if (Array.isArray(data.plan) || data.sessionUpdate === "plan")
      blocks.push({
        type: "plan",
        id: "plan",
        items: plan
          .map((item, index) => {
            const entry = record(item);
            const native = String(entry.status);
            return {
              id: String(index),
              title: text(entry.step ?? entry.content ?? entry.title, 1000),
              status: ["completed", "complete"].includes(native)
                ? ("completed" as const)
                : ["in_progress", "inProgress", "in-progress"].includes(native)
                  ? ("in-progress" as const)
                  : native === "cancelled"
                    ? ("cancelled" as const)
                    : ("pending" as const),
            };
          })
          .filter((item) => item.title),
      });
    if (typeof data.diff === "string" && data.diff)
      blocks.push({
        type: "diff",
        id: "turn-diff",
        path: "Änderungen des Agents",
        diff: text(data.diff, 64000),
      });
  }
  for (const [index, raw] of list(data.citations).entries()) {
    const entry = record(raw);
    blocks.push({
      type: "citation",
      id: `source-${Array.from(String(entry.url ?? entry.uri ?? entry.path ?? index)).reduce((hash, char) => Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0, 2166136261)}`,
      title:
        text(entry.title ?? entry.path ?? safeUrl(entry.url ?? entry.uri), 300) || "Agent-Quelle",
      url: safeUrl(entry.url ?? entry.uri),
      description: text(entry.description ?? entry.snippet, 1000) || undefined,
    });
  }
  if (event.kind === "tool" || event.kind === "artifact") {
    const result = record(data.result);
    if (event.kind === "tool")
      blocks.push({
        type: "tool",
        id,
        name: text(data.name, 300) || "Tool",
        status: data.status === undefined ? "" : status(data.status),
        output: safeOutput(data.result),
        ...toolDetails(data.arguments, text(data.name, 300)),
      });
    for (const [index, raw] of list(result.changes).entries()) {
      const change = record(raw);
      if (change.diff)
        blocks.push({
          type: "diff",
          id: `${id}-diff-${index}`,
          path: text(change.path, 1000) || "Datei",
          diff: text(change.diff, 64000),
        });
    }
    const content =
      event.kind === "artifact"
        ? [data.content]
        : Array.isArray(data.result)
          ? list(data.result)
          : list(result.content ?? record(result.output).content);
    for (const [index, raw] of content.entries()) {
      const wrapper = record(raw);
      const part = wrapper.type === "content" ? record(wrapper.content) : wrapper;
      if (part.type === "diff")
        blocks.push({
          type: "diff",
          id: `${id}-diff-${index}`,
          path: text(part.path, 1000) || "Datei",
          diff: `--- Vorher\n${text(part.oldText, 32000)
            .split("\n")
            .map((line) => `-${line}`)
            .join("\n")}\n+++ Nachher\n${text(part.newText, 32000)
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n")}`,
        });
      if (part.type === "image") {
        const src = aiRaster(part.data, text(part.mimeType, 100) || "image/png");
        if (src)
          blocks.push({
            type: "image",
            id: `${id}-image-${index}`,
            src,
            label: "Bild aus Agent-Ergebnis",
            status: "complete",
          });
      }
      const resource = record(part.resource);
      if (part.type === "resource_link" || part.type === "resource")
        blocks.push({
          type: "citation",
          id: `${id}-source-${index}`,
          title:
            text(part.name ?? resource.name ?? safeUrl(part.uri ?? resource.uri), 300) ||
            "Tool-Quelle",
          url: safeUrl(part.uri ?? resource.uri),
          description: text(part.description, 1000) || undefined,
        });
    }
    if (result.type === "imageGeneration")
      blocks.push({
        type: "image",
        id: `${id}-image`,
        src: aiRaster(result.result),
        label: text(result.savedPath, 1000) || "Generiertes Bild",
        status:
          status(data.status) === "error"
            ? "error"
            : aiRaster(result.result)
              ? "complete"
              : status(data.status) === "running"
                ? "generating"
                : "error",
      });
    const args = record(data.arguments);
    if (
      typeof args.connection === "string" ||
      typeof args.connection_id === "string" ||
      typeof args.connectionId === "string"
    ) {
      const context = [
        text(args.connection ?? args.connection_id ?? args.connectionId, 200),
        text(args.schema, 200),
        text(args.table, 200),
      ]
        .filter(Boolean)
        .join(" · ");
      blocks.push({
        type: "citation",
        id: `${id}-provenance`,
        title: text(data.name, 300) || "Datenbank-Tool",
        description: context,
      });
    }
  }
  return blocks;
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

export function interleaveAiRich(text: string, blocks: AiRichBlock[] = []) {
  const parts: { text: string; blocks: AiRichBlock[] }[] = [];
  let cursor = 0;
  const placed = blocks
    .map((block) => ({
      block,
      at: block.type === "citation" ? text.length : Math.min(block.at ?? text.length, text.length),
    }))
    .sort((a, b) => a.at - b.at);
  for (const { block, at } of placed) {
    if (parts.length && at === cursor) parts[parts.length - 1].blocks.push(block);
    else parts.push({ text: text.slice(cursor, at), blocks: [block] });
    cursor = at;
  }
  parts.push({ text: text.slice(cursor), blocks: [] });
  return parts;
}
