import { invoke } from "@tauri-apps/api/core";

export async function csvCheckDevelopmentContext() {
  const context = await invoke<{ ephemeral: boolean; directory: string }>(
    "csv_check_development_context",
  );
  if (context.ephemeral !== true || !context.directory)
    throw Error("Keine isolierte CSV-Entwicklungsumgebung.");
  return context;
}
