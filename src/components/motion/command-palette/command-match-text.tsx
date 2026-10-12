import type { ReactNode } from "react";
import { commandMatchRanges } from "@/lib/command-score";

export function CommandMatchText({ text, query }: { text: string; query: string }) {
  const ranges = commandMatchRanges(query, text);
  if (ranges.length === 0) return text;
  const parts: ReactNode[] = [];
  let offset = 0;
  for (const { start, end } of ranges) {
    parts.push(text.slice(offset, start));
    parts.push(
      <span
        key={start}
        className="underline decoration-blue-500 decoration-2 underline-offset-4 dark:decoration-blue-400"
      >
        {text.slice(start, end)}
      </span>,
    );
    offset = end;
  }
  parts.push(text.slice(offset));
  return <>{parts}</>;
}
