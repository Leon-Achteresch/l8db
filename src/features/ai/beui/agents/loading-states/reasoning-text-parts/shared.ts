import type { ReactNode } from "react";
export const DEFAULT_PHRASES = [
  "Thinking",
  "Reading the context",
  "Connecting the details",
  "Forming a response",
];
export const CASCADE_STAGGER = 0.025;
export type ReasoningTextVariant = "cascade" | "swap" | "scramble";
export interface ReasoningTextProps {
  phrases?: string[];
  variant?: ReasoningTextVariant;
  interval?: number;
  shimmerDuration?: number;
  indicator?: ReactNode;
  className?: string;
}
export type PhraseProps = {
  phrase: string;
  reduce: boolean;
  shimmerDuration: number;
};
