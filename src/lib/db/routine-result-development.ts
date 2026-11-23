import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "./types";

export async function confirmRoutineResultFixture(): Promise<void> {
  if ((await invoke("routine_result_development_ready")) !== true)
    throw Error("Keine isolierte PostgreSQL-Fixture.");
}

export function callRoutineResultFixture(routine: "fast" | "slow"): Promise<QueryResult> {
  return invoke("routine_result_development_call", { routine });
}
