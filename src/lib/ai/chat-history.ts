import type { AiMessage, AiProfile } from "@/lib/db/ai";
import { editorAiSupported, runEditorAi } from "./editor/client";
import { summaryRequest } from "./editor/context";
import { compactHistory, type HistoryMessage, historyNeedsSummary } from "./editor/history";
import type { AiRichBlock } from "./rich";
import type { AiSession } from "./store";

export const CHAT_HISTORY_CHARS = 40_000;
export const WORK_LOG_CHARS = 1_500;
const KEEP_LAST = 6;

function clip(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function firstLine(text: string) {
  const start = text.search(/\S/);
  if (start < 0) return "";
  const end = text.indexOf("\n", start);
  return text.slice(
    start,
    end < 0 ? Math.min(text.length, start + 400) : Math.min(end, start + 400),
  );
}

function lastLine(text: string) {
  const trimmed = text.slice(Math.max(0, text.length - 400)).trimEnd();
  return trimmed.slice(trimmed.lastIndexOf("\n") + 1);
}

function outcome(block: Extract<AiRichBlock, { type: "tool" }>) {
  if (block.status === "error") return `error: ${clip(firstLine(block.output), 160)}`;
  const footer = lastLine(block.output);
  return clip(/^\(\d+ rows/.test(footer) ? footer : firstLine(block.output), 160);
}

export function workLog(rich: AiRichBlock[] | undefined): string {
  let size = 0;
  const kept: string[] = [];
  for (let index = (rich?.length ?? 0) - 1; index >= 0; index--) {
    const block = rich?.[index];
    if (block?.type !== "tool" || block.status === "running" || block.name === "plan") continue;
    const sql = block.sql ? ` ${clip(block.sql.slice(0, 2_000), 300)}` : "";
    const line = `- ${block.name}${sql} -> ${outcome(block)}`;
    if (size + line.length + 1 > WORK_LOG_CHARS) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  return kept.length ? `<work-log>\n${kept.join("\n")}\n</work-log>` : "";
}

export function wireMessage({ role, text, context, rich }: AiMessage): HistoryMessage {
  const log = role === "assistant" ? workLog(rich) : "";
  const body = log ? (text ? `${text}\n\n${log}` : log) : text;
  return { role, text: context ? `${body}\n\n${context}` : body };
}

function validSummary(turn: AiMessage[], summary: AiSession["summary"]) {
  return summary && summary.count > 0 && turn[summary.count - 1]?.id === summary.upTo
    ? { count: summary.count, text: summary.text }
    : null;
}

export function chatWireMessages(
  turn: AiMessage[],
  summary?: AiSession["summary"],
): { messages: HistoryMessage[]; compacted: number; summarizeUpTo: number } {
  const wire = turn.map(wireMessage);
  const options = {
    maxChars: CHAT_HISTORY_CHARS,
    keepLast: KEEP_LAST,
    summary: validSummary(turn, summary),
  };
  const { messages, compacted } = compactHistory(wire, options);
  const needs = historyNeedsSummary(wire, options);
  return { messages, compacted, summarizeUpTo: needs.needed ? needs.count : 0 };
}

export async function summarizeChat(
  turn: AiMessage[],
  count: number,
  profile: AiProfile,
): Promise<AiSession["summary"] | null> {
  const upTo = turn[count - 1]?.id;
  if (!upTo || !editorAiSupported(profile)) return null;
  const response = await runEditorAi({
    action: "summary",
    profile,
    ...summaryRequest(turn.slice(0, count).map(wireMessage)),
  });
  const text = response.text.trim();
  return text ? { upTo, count, text } : null;
}
