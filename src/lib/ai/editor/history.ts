export interface HistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export interface HistoryOptions {
  maxChars?: number;
  keepLast?: number;
  summary?: { count: number; text: string } | null;
}

const SUMMARY_PREFIX = "Zusammenfassung des bisherigen Gesprächs:\n";
const USER_LIMIT = 600;
const ASSISTANT_HEAD = 400;
const ASSISTANT_TAIL = 200;

function isHigh(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function isLow(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function head(text: string, length: number): string {
  let end = Math.min(length, text.length);
  if (end > 0 && end < text.length && isHigh(text.charCodeAt(end - 1))) end--;
  return text.slice(0, end);
}

function tail(text: string, length: number): string {
  let start = Math.max(0, text.length - length);
  if (start > 0 && isLow(text.charCodeAt(start))) start++;
  return text.slice(start);
}

export function shortenMessage(message: HistoryMessage): HistoryMessage {
  const { text } = message;
  if (message.role === "user") {
    return text.length <= USER_LIMIT
      ? message
      : { role: "user", text: `${head(text, USER_LIMIT - 1)}…` };
  }
  return text.length <= ASSISTANT_HEAD + ASSISTANT_TAIL + 1
    ? message
    : { role: "assistant", text: `${head(text, ASSISTANT_HEAD)}…${tail(text, ASSISTANT_TAIL)}` };
}

function totalChars(messages: HistoryMessage[]): number {
  let total = 0;
  for (const message of messages) total += message.text.length;
  return total;
}

function splitPoint(messages: HistoryMessage[], keepLast: number): number {
  return Math.max(0, messages.length - Math.max(1, keepLast));
}

export function historyNeedsSummary(
  messages: HistoryMessage[],
  options: HistoryOptions = {},
): { needed: boolean; count: number } {
  const maxChars = options.maxChars ?? 24_000;
  if (totalChars(messages) <= maxChars) return { needed: false, count: 0 };
  let count = splitPoint(messages, options.keepLast ?? 6);
  while (count > 0 && messages[count]?.role !== "user") count--;
  const covered = options.summary?.count ?? 0;
  return { needed: count > covered, count };
}

export function compactHistory(
  messages: HistoryMessage[],
  options: HistoryOptions = {},
): { messages: HistoryMessage[]; compacted: number } {
  const maxChars = options.maxChars ?? 24_000;
  if (messages.length === 0 || totalChars(messages) <= maxChars) return { messages, compacted: 0 };
  const split = splitPoint(messages, options.keepLast ?? 6);
  const kept = messages.slice(split);
  const covered = Math.min(Math.max(0, options.summary?.count ?? 0), split);
  const summary: HistoryMessage | null =
    options.summary && covered > 0
      ? { role: "user", text: `${SUMMARY_PREFIX}${options.summary.text}` }
      : null;
  let middle = messages.slice(covered, split).map(shortenMessage);
  const withPrefix = () => {
    const rest = [...middle, ...kept];
    if (!summary) return rest;
    return rest[0]?.role === "assistant"
      ? [summary, ...rest]
      : [summary, { role: "assistant" as const, text: "OK." }, ...rest];
  };
  const fixed = totalChars(kept) + (summary ? summary.text.length + 3 : 0);
  let middleChars = totalChars(middle);
  let first = 0;
  while (first < middle.length && fixed + middleChars > maxChars) {
    const drop = first + 1 < middle.length && middle[first].role !== middle[first + 1].role ? 2 : 1;
    for (let index = first; index < first + drop; index++) middleChars -= middle[index].text.length;
    first += drop;
  }
  middle = middle.slice(first);
  let result = withPrefix();
  while (result.length > 1 && result[0].role !== "user") result = result.slice(1);
  const original = new Set(messages);
  let verbatim = 0;
  for (const message of result) if (original.has(message)) verbatim++;
  return { messages: result, compacted: messages.length - verbatim };
}
