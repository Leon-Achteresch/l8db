import { useDbSelectionStore } from "@/lib/db-selection";
import { ctx } from "@/lib/monaco-intellisense/context";
import type { EditorAiEnvironment } from "./context";

export function currentEditorAiEnvironment(): EditorAiEnvironment {
  const connection = ctx.connection;
  return {
    registry: ctx.registry,
    connection,
    database: ctx.database,
    defaultSchema: connection
      ? (useDbSelectionStore.getState().schemaByConnection[connection.id] ?? null)
      : null,
    queryClient: ctx.queryClient,
  };
}
