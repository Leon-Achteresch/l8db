import { compileSearchPatterns, splitSearchPatterns } from "@/lib/regex-search";
import type { Condition } from "./types";

export function createId(): string {
  return crypto.randomUUID();
}

export function emptyCondition(column = ""): Condition {
  return { id: createId(), column, operator: "eq", value: "" };
}

export function parsePatterns(raw: string, useRegex: boolean): ((name: string) => boolean)[] {
  const parts = splitSearchPatterns(raw);
  if (parts.length === 0) return [];
  return parts.map((pattern) => {
    if (useRegex) {
      const compiled = compileSearchPatterns(pattern, { global: false });
      if (compiled.ok) return (name: string) => compiled.regexes.some((regex) => regex.test(name));
    }
    const lower = pattern.toLowerCase();
    return (name: string) => name.toLowerCase().includes(lower);
  });
}
