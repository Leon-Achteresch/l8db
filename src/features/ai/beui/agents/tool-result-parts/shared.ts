import type { ReactNode } from "react";
import type { AgentCodeLanguage } from "@/features/ai/beui/agents/agent-code";
export type ToolResultStatus = "running" | "success" | "error" | "cancelled";
export type ToolResultKind = "terminal" | "request" | "custom";
export interface ToolResultProps {
  tool: ReactNode;
  title: ReactNode;
  children: ReactNode;
  status?: ToolResultStatus;
  kind?: ToolResultKind;
  meta?: ReactNode;
  icon?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number;
  copyText?: string;
  onCopy?: () => void | Promise<void>;
  onRetry?: () => void;
  className?: string;
  contentClassName?: string;
}
export interface ToolResultOutputProps {
  children: string;
  language?: AgentCodeLanguage;
  className?: string;
}
export function getStatusLabel(status: ToolResultStatus) {
  if (status === "running") return "Läuft";
  if (status === "success") return "Abgeschlossen";
  if (status === "error") return "Fehlgeschlagen";
  return "Abgebrochen";
}
export function getSwapKey(value: ReactNode, fallback: string) {
  return typeof value === "string" || typeof value === "number" ? String(value) : fallback;
}
export function getStatusClass(status: ToolResultStatus) {
  if (status === "running") {
    return "text-blue-600 dark:text-blue-400";
  }
  if (status === "success") {
    return "text-emerald-600 dark:text-emerald-400";
  }
  if (status === "error") {
    return "text-rose-600 dark:text-rose-400";
  }
  return "text-muted-foreground";
}
