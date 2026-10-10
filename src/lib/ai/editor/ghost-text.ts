import { stripFences } from "./edit-format";

export interface GhostCacheEntry {
  key: string;
  prefix: string;
  text: string;
}

export function cleanCompletion(raw: string, linePrefix: string, suffix: string): string {
  let text = (/^\s*(`{3,}|~{3,})/m.test(raw) ? stripFences(raw) : raw).replace(/\r\n/g, "\n");
  text = text.replace(/<CURSOR>/g, "");
  const trimmedLine = linePrefix.trimStart();
  if (trimmedLine && text.startsWith(trimmedLine)) text = text.slice(trimmedLine.length);
  else if (linePrefix && text.startsWith(linePrefix)) text = text.slice(linePrefix.length);
  else {
    const partial = /[\w$]+$/.exec(linePrefix)?.[0];
    if (partial && text.toLowerCase().startsWith(partial.toLowerCase()))
      text = text.slice(partial.length);
  }
  if (/\s$/.test(linePrefix) || !linePrefix) text = text.replace(/^[ \t]+/, "");
  const suffixHead = suffix.split("\n")[0];
  if (suffixHead.trim()) {
    for (let length = Math.min(suffixHead.length, text.length); length > 0; length--) {
      if (text.endsWith(suffixHead.slice(0, length))) {
        text = text.slice(0, text.length - length);
        break;
      }
    }
  }
  const lines = text.split("\n");
  if (lines.length > 8) text = lines.slice(0, 8).join("\n");
  return text.trim() ? text.trimEnd() : "";
}

export function fromCache(
  entry: GhostCacheEntry | null,
  key: string,
  prefix: string,
): string | null {
  if (!entry || entry.key !== key || !prefix.startsWith(entry.prefix)) return null;
  const typed = prefix.slice(entry.prefix.length);
  if (!entry.text.startsWith(typed)) return null;
  const rest = entry.text.slice(typed.length);
  return rest ? rest : null;
}

export function shouldRequest(
  linePrefix: string,
  lineSuffix: string,
  documentText: string,
): boolean {
  if (documentText.trim().length < 2) return false;
  if (/^[\w$]/.test(lineSuffix)) return false;
  if ((linePrefix.match(/'/g) ?? []).length % 2 === 1) return false;
  return !linePrefix.includes("--");
}

export function singleLineIfNeeded(text: string, lineSuffix: string): string {
  return lineSuffix.trim() ? text.split("\n")[0] : text;
}
