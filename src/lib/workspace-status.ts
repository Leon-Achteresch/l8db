import { create } from "zustand";

export const WORKSPACE_MESSAGE_DURATION = 3_000;

export interface WorkspaceMessage {
  id: number;
  title: string;
  tone: "success" | "error" | "neutral";
}

export const useWorkspaceStatusStore = create<{ message: WorkspaceMessage | null }>(() => ({
  message: null,
}));

let sequence = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

export function clearWorkspaceMessage(id: number): void {
  useWorkspaceStatusStore.setState((state) =>
    state.message?.id === id ? { message: null } : state,
  );
}

export function showWorkspaceMessage(
  title: string,
  tone: WorkspaceMessage["tone"] = "success",
): void {
  if (timer !== undefined) clearTimeout(timer);
  const id = ++sequence;
  useWorkspaceStatusStore.setState({ message: { id, title, tone } });
  timer = setTimeout(() => clearWorkspaceMessage(id), WORKSPACE_MESSAGE_DURATION);
}

export function showCopiedMessage(title = "In die Zwischenablage kopiert"): void {
  showWorkspaceMessage(title);
}

export function formatQueryElapsed(startedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1_000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
