import type { AiMessage } from "@/lib/db/ai";
import { WORK_LOG_CHARS } from "./chat-history";
import type { AiSession } from "./store";

export type ContextTileKind =
  | "system"
  | "project"
  | "tools"
  | "context"
  | "chat"
  | "results"
  | "summary"
  | "draft"
  | "other";

export interface ContextTile {
  id: string;
  label: string;
  kind: ContextTileKind;
  tokens: number;
}

export interface ContextLayout {
  system?: number;
  skills?: number;
  knowledge?: number;
  files?: number;
  tools?: number;
}

export interface ContextMap {
  tiles: ContextTile[];
  used: number;
  limit: number;
  compacted: number;
  saved: number;
}

export interface PlacedTile extends ContextTile {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MAX_TILES = 24;
const tokens = (chars: number) => Math.ceil(Math.max(0, chars) / 4);
const positive = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;

function add(tiles: Map<string, ContextTile & { count: number }>, tile: ContextTile) {
  if (tile.tokens <= 0) return;
  const existing = tiles.get(tile.id);
  if (existing) {
    existing.tokens += tile.tokens;
    existing.count += 1;
  } else tiles.set(tile.id, { ...tile, count: 1 });
}

function logChars(message: AiMessage) {
  let size = 0;
  for (const block of message.rich ?? [])
    if (block.type === "tool" && block.status !== "running" && block.name !== "plan")
      size +=
        6 +
        block.name.length +
        Math.min(block.sql?.length ?? 0, 301) +
        Math.min(block.output.length, 160);
  return size ? Math.min(size, WORK_LOG_CHARS) + 22 : 0;
}

function messageTiles(messages: AiMessage[], latest: AiMessage | undefined) {
  const tiles = new Map<string, ContextTile & { count: number }>();
  let total = 0;
  const put = (tile: ContextTile) => {
    total += tile.tokens;
    add(tiles, tile);
  };
  for (const message of messages) {
    put({ id: "chat", label: "Chat", kind: "chat", tokens: tokens(message.text.length) });
    if (message.context) {
      const label = message.contextLabels?.length ? message.contextLabels.join(", ") : "Kontext";
      put({
        id: `context:${label}`,
        label,
        kind: "context",
        tokens: tokens(message.context.length),
      });
    }
    if (message.role !== "assistant") continue;
    if (message !== latest) {
      put({
        id: "results:log",
        label: "Arbeitsprotokoll",
        kind: "results",
        tokens: tokens(logChars(message)),
      });
      continue;
    }
    for (const block of message.rich ?? [])
      if (block.type === "tool" && block.name !== "plan")
        put({
          id: `results:${block.name}`,
          label: block.name,
          kind: "results",
          tokens: tokens(block.output.length + (block.sql?.length ?? 0)),
        });
  }
  return {
    total,
    tiles: [...tiles.values()].map(
      ({ count, ...tile }): ContextTile =>
        tile.kind === "results" && count > 1
          ? { ...tile, label: `${tile.label} · ${count}×` }
          : tile,
    ),
  };
}

export function buildContextMap(input: {
  layout: ContextLayout;
  messages: AiMessage[];
  summary?: AiSession["summary"];
  prompt: string;
  measured: number | null;
  limit: number;
  compact?: boolean;
}): ContextMap {
  const { layout, messages, summary, prompt, measured, limit } = input;
  const valid =
    input.compact !== false &&
    summary &&
    summary.count > 0 &&
    messages[summary.count - 1]?.id === summary.upTo
      ? summary
      : null;
  const covered = valid ? valid.count : 0;
  const kept = messages.slice(covered);
  const latest = messages.at(-1)?.role === "assistant" ? messages.at(-1) : undefined;
  const history = messageTiles(kept, latest);
  const tiles = (
    [
      {
        id: "system",
        label: "System",
        kind: "system",
        tokens: tokens(positive(layout.system)),
      },
      {
        id: "tools",
        label: "Tools",
        kind: "tools",
        tokens: tokens(positive(layout.tools)),
      },
      { id: "skills", label: "Skills", kind: "project", tokens: tokens(positive(layout.skills)) },
      {
        id: "knowledge",
        label: "Wissen",
        kind: "project",
        tokens: tokens(positive(layout.knowledge)),
      },
      { id: "files", label: "Dateien", kind: "project", tokens: tokens(positive(layout.files)) },
      ...(valid
        ? [
            {
              id: "summary",
              label: "Zusammenfassung",
              kind: "summary" as const,
              tokens: tokens(valid.text.length),
            },
          ]
        : []),
      ...history.tiles,
      { id: "draft", label: "Entwurf", kind: "draft", tokens: tokens(prompt.length) },
    ] satisfies ContextTile[] as ContextTile[]
  ).filter((tile) => tile.tokens > 0);
  if (tiles.length > MAX_TILES) {
    tiles.sort((a, b) => b.tokens - a.tokens);
    const rest = tiles.splice(MAX_TILES - 1);
    tiles.push({
      id: "rest",
      label: `${rest.length} weitere`,
      kind: "other",
      tokens: rest.reduce((sum, tile) => sum + tile.tokens, 0),
    });
  }
  const estimated = tiles.reduce((sum, tile) => sum + tile.tokens, 0);
  let used = estimated;
  if (measured !== null && measured > 0) {
    used = measured;
    if (measured > estimated)
      tiles.push({
        id: "other",
        label: "Agent-intern",
        kind: "other",
        tokens: measured - estimated,
      });
    else if (estimated > 0)
      for (const tile of tiles)
        tile.tokens = Math.max(1, Math.round((tile.tokens * measured) / estimated));
  }
  const saved = valid
    ? Math.max(
        0,
        messageTiles(messages.slice(0, covered), latest).total - tokens(valid.text.length),
      )
    : 0;
  return { tiles, used, limit: Math.max(1, limit), compacted: covered, saved };
}

function worst(row: number[], side: number) {
  const sum = row.reduce((a, b) => a + b, 0);
  const max = Math.max(...row);
  const min = Math.min(...row);
  return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
}

export function squarify<T extends { tokens: number }>(
  items: T[],
  rect: { x: number; y: number; w: number; h: number },
): (T & { x: number; y: number; w: number; h: number })[] {
  const total = items.reduce((sum, item) => sum + Math.max(0, item.tokens), 0);
  if (!total || rect.w <= 0 || rect.h <= 0) return [];
  const scale = (rect.w * rect.h) / total;
  const queue = items
    .filter((item) => item.tokens > 0)
    .sort((a, b) => b.tokens - a.tokens)
    .map((item) => ({ item, area: item.tokens * scale }));
  const placed: (T & { x: number; y: number; w: number; h: number })[] = [];
  let { x, y, w, h } = rect;
  while (queue.length) {
    const side = Math.min(w, h);
    const row = [queue[0]];
    let index = 1;
    while (
      index < queue.length &&
      worst(
        [...row, queue[index]].map((entry) => entry.area),
        side,
      ) <=
        worst(
          row.map((entry) => entry.area),
          side,
        )
    )
      row.push(queue[index++]);
    queue.splice(0, row.length);
    const area = row.reduce((sum, entry) => sum + entry.area, 0);
    const thickness = area / side;
    let offset = 0;
    for (const entry of row) {
      const length = entry.area / thickness;
      placed.push(
        w >= h
          ? { ...entry.item, x, y: y + offset, w: thickness, h: length }
          : { ...entry.item, x: x + offset, y, w: length, h: thickness },
      );
      offset += length;
    }
    if (w >= h) {
      x += thickness;
      w -= thickness;
    } else {
      y += thickness;
      h -= thickness;
    }
  }
  return placed;
}

export function placeContextMap(map: ContextMap, width: number, height: number) {
  const share = Math.min(1, map.used / map.limit);
  const usedWidth = map.tiles.length ? Math.max(width * share, Math.min(width, 24)) : 0;
  return {
    tiles: squarify(map.tiles, { x: 0, y: 0, w: usedWidth, h: height }) as PlacedTile[],
    free: usedWidth < width ? { x: usedWidth, y: 0, w: width - usedWidth, h: height } : null,
  };
}
