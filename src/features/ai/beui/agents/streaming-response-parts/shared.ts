import type { ReactNode } from "react";
import type { CitationItem } from "@/features/ai/beui/agents/citations";
export type StreamingResponseStatus = "streaming" | "complete" | "error";
export type StreamingResponseFeedback = "up" | "down" | null;
export interface StreamingResponseProps {
  children: ReactNode;
  status?: StreamingResponseStatus;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void;
  sources?: CitationItem[];
  sourcesOpen?: boolean;
  defaultSourcesOpen?: boolean;
  onSourcesOpenChange?: (open: boolean) => void;
  sourceIdPrefix?: string;
  feedback?: StreamingResponseFeedback;
  defaultFeedback?: StreamingResponseFeedback;
  onFeedbackChange?: (feedback: StreamingResponseFeedback) => void;
  announce?: boolean;
  showActions?: boolean;
  className?: string;
  contentClassName?: string;
  actionsClassName?: string;
}
