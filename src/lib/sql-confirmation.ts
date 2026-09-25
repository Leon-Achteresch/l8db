import { create } from "zustand";
import type { DestructiveStatement } from "@/lib/sql-safety";

export interface SqlConfirmation {
  id: string;
  connection: string;
  database: string | null;
  statements: DestructiveStatement[];
  confirmTexts?: string[];
  title?: string;
  description?: string;
  confirmLabel?: string;
}

interface ConfirmationState {
  requests: SqlConfirmation[];
}

export const useSqlConfirmation = create<ConfirmationState>(() => ({ requests: [] }));
const answers = new Map<string, (answer: boolean) => void>();

export function requestSqlConfirmation(request: Omit<SqlConfirmation, "id">): Promise<boolean> {
  const id = crypto.randomUUID();
  return new Promise((resolve) => {
    answers.set(id, resolve);
    useSqlConfirmation.setState((state) => ({ requests: [...state.requests, { ...request, id }] }));
  });
}

export function answerSqlConfirmation(id: string, accepted: boolean) {
  const resolve = answers.get(id);
  answers.delete(id);
  useSqlConfirmation.setState((state) => ({
    requests: state.requests.filter((request) => request.id !== id),
  }));
  resolve?.(accepted);
}
