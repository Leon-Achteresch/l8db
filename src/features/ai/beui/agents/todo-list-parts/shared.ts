import type { ReactNode } from "react";
export type TodoItemStatus = "pending" | "in-progress" | "completed" | "cancelled";
export interface TodoItem {
  id: string;
  title: ReactNode;
  status?: TodoItemStatus;
  progress?: number;
  detail?: ReactNode;
}
export interface TodoListProps {
  items: TodoItem[];
  title?: ReactNode;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  collapseOnComplete?: boolean;
  maxHeight?: number;
  className?: string;
}
export function statusLabel(status: TodoItemStatus) {
  if (status === "in-progress") return "In Arbeit";
  if (status === "completed") return "Abgeschlossen";
  if (status === "cancelled") return "Abgebrochen";
  return "Ausstehend";
}
