import type { AiEvent } from "@/lib/db/ai";
import { type AiRichBlock, aiRaster, list, record, safeUrl, text, toolDetails } from "./rich-core";

export { type AiRichBlock, aiRaster, mergeAiRich, sanitizeAiRich } from "./rich-core";

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
