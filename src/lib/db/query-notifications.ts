import { invoke } from "@/lib/db/core";

export function notifyQueryCompletion(
  outcome: "success" | "error",
  durationMs: number,
): Promise<void> {
  return invoke("notify_query_completion", { succeeded: outcome === "success", durationMs });
}
