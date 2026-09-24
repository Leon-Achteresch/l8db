import { startTransition, useEffect, useState } from "react";
import { scoreNeedle, sortScored } from "@/lib/command-score";

const SLICE_MS = 3;

function limit<T>(list: T[], max: number | undefined) {
  return max && list.length > max ? list.slice(0, max) : list;
}

export function useRankedCommands<T extends { label: string; group?: string; keywords?: string[] }>(
  items: T[],
  query: string,
  max: number | undefined,
) {
  const [result, setResult] = useState(() => ({ query: "", list: limit(items, max) }));

  useEffect(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      setResult({ query, list: limit(items, max) });
      return;
    }
    const scored: { item: T; score: number }[] = [];
    let index = 0;
    let timer = 0;
    const step = () => {
      const end = performance.now() + SLICE_MS;
      while (index < items.length && performance.now() < end) {
        const stop = Math.min(items.length, index + 100);
        for (; index < stop; index++) {
          const score = scoreNeedle(needle, items[index]);
          if (score > 0) scored.push({ item: items[index], score });
        }
      }
      if (index < items.length) timer = window.setTimeout(step);
      else startTransition(() => setResult({ query, list: limit(sortScored(scored), max) }));
    };
    step();
    return () => window.clearTimeout(timer);
  }, [items, query, max]);

  return result;
}
