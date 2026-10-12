import type { AiMessage, AiProfile } from "@/lib/db/ai";
import { editorAiSupported, runEditorAi } from "./editor/client";
import { summaryRequest } from "./editor/context";
import { compactHistory, type HistoryMessage, historyNeedsSummary } from "./editor/history";
import type { AiSession } from "./store";

export const CHAT_HISTORY_CHARS = 40_000;
const KEEP_LAST = 6;

export function wireMessage({ role, text, context }: AiMessage): HistoryMessage {
  return { role, text: context ? `${text}\n\n${context}` : text };
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
