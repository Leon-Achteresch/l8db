import { useReducedMotion } from "motion/react";
import { useEffect, useId, useState } from "react";
import { TEXT_SHIMMER_KEYFRAMES } from "@/features/ai/beui/lib/text-shimmer";
import { Loader } from "@/features/ai/beui/motion/loader";
import { cn } from "@/lib/utils";
import { CascadePhrase } from "./cascade-phrase";
import { ScramblePhrase } from "./scramble-phrase";
import { DEFAULT_PHRASES, type ReasoningTextProps } from "./shared";
import { SwapPhrase } from "./swap-phrase";

export function ReasoningText({
  phrases = DEFAULT_PHRASES,
  variant = "cascade",
  interval = 1800,
  shimmerDuration = 2.2,
  indicator,
  className,
}: ReasoningTextProps) {
  const reduce = useReducedMotion() ?? false;
  const [index, setIndex] = useState(0);
  const statusId = useId();
  const safePhrases = phrases.length > 0 ? phrases : DEFAULT_PHRASES;
  const phrase = safePhrases[index % safePhrases.length];
  const longestPhrase = safePhrases.reduce((longest, current) =>
    current.length > longest.length ? current : longest,
  );
  const phraseProps = { phrase, reduce, shimmerDuration };
  useEffect(() => {
    if (safePhrases.length < 2) return;
    const timer = window.setInterval(
      () => {
        setIndex((current) => (current + 1) % safePhrases.length);
      },
      Math.max(600, interval),
    );
    return () => window.clearInterval(timer);
  }, [interval, safePhrases.length]);
  return (
    <>
      <style>{TEXT_SHIMMER_KEYFRAMES}</style>
      <span
        role="status"
        aria-live="polite"
        aria-labelledby={statusId}
        className={cn(
          "inline-flex items-center gap-2 text-sm font-medium text-muted-foreground",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className="inline-flex size-3 shrink-0 items-center justify-center"
        >
          {indicator ?? <Loader variant="ascii-line" size={14} speed={0.8} label="Reasoning" />}
        </span>

        <span aria-hidden="true" className="grid overflow-hidden text-left">
          <span className="invisible col-start-1 row-start-1 whitespace-nowrap">
            {longestPhrase}…
          </span>
          {variant === "cascade" ? (
            <CascadePhrase {...phraseProps} />
          ) : variant === "scramble" ? (
            <ScramblePhrase {...phraseProps} />
          ) : (
            <SwapPhrase {...phraseProps} />
          )}
        </span>

        <span id={statusId} className="sr-only">
          {phrase}
        </span>
      </span>
    </>
  );
}
