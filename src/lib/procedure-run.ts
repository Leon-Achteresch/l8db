import type { QueryResult } from "./db";

export type ProcedureRunState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; result: QueryResult; runId: number }
  | { status: "error"; message: string };

export type ProcedureRunSnapshot = {
  scope: object | null;
  pending: boolean;
  state: ProcedureRunState;
};

export const IDLE_PROCEDURE_RUN: ProcedureRunState = { status: "idle" };

export function createProcedureRun() {
  let snapshot: ProcedureRunSnapshot = {
    scope: null,
    pending: false,
    state: IDLE_PROCEDURE_RUN,
  };
  let revision = 0;
  const listeners = new Set<() => void>();
  const update = (next: ProcedureRunSnapshot) => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setScope(scope: object | null) {
      if (scope === snapshot.scope) return;
      revision += 1;
      update({ scope, pending: snapshot.pending, state: IDLE_PROCEDURE_RUN });
    },
    async run(scope: object | null, execute: () => Promise<QueryResult>) {
      if (!scope || scope !== snapshot.scope || snapshot.pending) return false;
      const current = ++revision;
      update({ scope, pending: true, state: { status: "loading" } });
      let state: ProcedureRunState;
      try {
        state = { status: "success", result: await execute(), runId: current };
      } catch (error) {
        state = { status: "error", message: String(error) };
      }
      update({
        scope: snapshot.scope,
        pending: false,
        state: current === revision && scope === snapshot.scope ? state : snapshot.state,
      });
      return true;
    },
  };
}
