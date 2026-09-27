import { AnimatedNumber } from "@/components/animated-number";
import type { Headline } from "./chart-summary";

export function ChartHeadline({ headline }: { headline: Headline }) {
  if ("text" in headline) return headline.text;
  return <AnimatedNumber value={headline.value} suffix={headline.suffix} />;
}
