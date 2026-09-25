import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { notebookToHtml, notebookToMarkdown } from "./export";
import {
  pickNotebookFile,
  pickNotebookTarget,
  readNotebookFile,
  writeExportFile,
  writeNotebookText,
} from "./files";
import { serializeNotebook } from "./model";
import { useNotebookStore } from "./store";

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function confirmDiscard(): boolean {
  return (
    !useNotebookStore.getState().dirty ||
    window.confirm("Das aktuelle Notebook hat ungespeicherte Änderungen. Verwerfen?")
  );
}

export function newNotebookDraft(connectionId: string | null): void {
  if (!confirmDiscard()) return;
  useNotebookStore.getState().reset(connectionId);
}

export async function openNotebook(path?: string): Promise<boolean> {
  if (!confirmDiscard()) return false;
  try {
    const target = path ?? (await pickNotebookFile());
    if (!target) return false;
    const { doc, outputs } = await readNotebookFile(target);
    const connections = useConnectionsStore.getState().connections;
    const connection =
      connections.find((c) => c.id === doc.connectionId) ??
      connections.find((c) => doc.connectionName && c.name === doc.connectionName);
    useNotebookStore
      .getState()
      .load({ ...doc, connectionId: connection?.id ?? null }, outputs, target);
    return true;
  } catch (error) {
    if (path) useNotebookStore.getState().forgetRecent(path);
    toast.error(`Notebook konnte nicht geöffnet werden: ${message(error)}`);
    return false;
  }
}

export async function saveNotebook(saveAs = false): Promise<boolean> {
  const state = useNotebookStore.getState();
  try {
    const path =
      !saveAs && state.filePath ? state.filePath : await pickNotebookTarget(state.doc.name);
    if (!path) return false;
    const connectionName =
      useConnectionsStore.getState().connections.find((c) => c.id === state.doc.connectionId)
        ?.name ?? null;
    await writeNotebookText(
      path,
      serializeNotebook({ ...state.doc, connectionName }, state.outputs),
    );
    useNotebookStore.getState().markSaved(path);
    toast.success("Notebook gespeichert");
    return true;
  } catch (error) {
    toast.error(`Notebook konnte nicht gespeichert werden: ${message(error)}`);
    return false;
  }
}

export async function exportNotebook(format: "md" | "html"): Promise<void> {
  const { doc, outputs } = useNotebookStore.getState();
  try {
    const content =
      format === "md" ? notebookToMarkdown(doc, outputs) : notebookToHtml(doc, outputs);
    if (await writeExportFile(doc.name, format, content)) toast.success("Notebook exportiert");
  } catch (error) {
    toast.error(`Export fehlgeschlagen: ${message(error)}`);
  }
}
