import { TEXT_SHIMMER_CLASS_NAME, textShimmerStyle } from "@/features/ai/beui/lib/text-shimmer";
import { TextScramble } from "@/features/ai/beui/motion/text-scramble";
import { cn } from "@/lib/utils";
import type { PhraseProps } from "./shared";

export function ScramblePhrase({ phrase, shimmerDuration }: PhraseProps) {
  const target = `${phrase}…`;
  return (
    <TextScramble
      text={target}
      className={cn(
        "col-start-1 row-start-1 justify-self-start tabular-nums",
        TEXT_SHIMMER_CLASS_NAME,
      )}
      style={textShimmerStyle(shimmerDuration)}
    />
  );
}
