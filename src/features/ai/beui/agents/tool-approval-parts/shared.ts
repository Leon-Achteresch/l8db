import type { ReactNode } from "react";
import type { AgentCodeLanguage } from "@/features/ai/beui/agents/agent-code";
export type ToolApprovalStatus =
  | "pending"
  | "approving"
  | "approved"
  | "denied"
  | "running"
  | "complete"
  | "error";
export interface ToolApprovalParameter {
  id: string;
  label: ReactNode;
  value: ReactNode;
}
export interface ToolApprovalCodeProps {
  code: string;
  language?: AgentCodeLanguage;
  className?: string;
}
export interface ToolApprovalProps {
  tool: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  parameters?: ToolApprovalParameter[];
  status?: ToolApprovalStatus;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  onApprove?: () => void;
  onAlwaysAllow?: () => void;
  onDeny?: () => void;
  className?: string;
}
export function getStatusCopy(status: ToolApprovalStatus) {
  if (status === "approving") return "Wird freigegeben";
  if (status === "approved") return "Erlaubt";
  if (status === "denied") return "Abgelehnt";
  if (status === "running") return "Läuft";
  if (status === "complete") return "Abgeschlossen";
  if (status === "error") return "Fehlgeschlagen";
  return "Freigabe erforderlich";
}
export function getStatusBadgeClass(status: ToolApprovalStatus) {
  if (status === "pending") {
    return "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  if (status === "approving" || status === "running") {
    return "border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400";
  }
  if (status === "approved" || status === "complete") {
    return "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
  }
  return "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400";
}
