import type { Task } from "@/lib/db/automation";

const drafts = new Map<string, { task: Task; revision: number | null }>();

export function stashDraft(task: Task, revision: number | null) {
  drafts.set(task.id, { task, revision });
}

export function peekDraft(id: string): { task: Task; revision: number | null } | null {
  return drafts.get(id) ?? null;
}

export function dropDraft(id: string) {
  drafts.delete(id);
}
