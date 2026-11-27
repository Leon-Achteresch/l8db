import { toast } from "sonner";
import { useConnectionsStore } from "@/lib/connections";
import { notebookToHtml, notebookToMarkdown } from "./export";
import {
  pickExportTarget,
  pickNotebookFile,
  pickNotebookTarget,
  readNotebookFile,
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

type NotebookState = ReturnType<typeof useNotebookStore.getState>;
let lastSave: { state: NotebookState; saveAs: boolean; result: Promise<boolean> } | null = null;

export function saveNotebook(saveAs = false): Promise<boolean> {
  const state = useNotebookStore.getState();
  if (
    lastSave &&
    lastSave.saveAs === saveAs &&
    lastSave.state.documentGeneration === state.documentGeneration &&
    lastSave.state.doc === state.doc &&
    (!state.doc.saveResults || lastSave.state.outputs === state.outputs)
  ) {
    return lastSave.result;
  }
  const result = (lastSave?.result ?? Promise.resolve()).then(() =>
    writeNotebookSnapshot(state, saveAs),
  );
  lastSave = { state, saveAs, result };
  void result.finally(() => {
    if (lastSave?.result === result) lastSave = null;
  });
  return result;
}

async function writeNotebookSnapshot(state: NotebookState, saveAs: boolean): Promise<boolean> {
  try {
    const current = useNotebookStore.getState();
    if (current.documentGeneration !== state.documentGeneration) return false;
    const path =
      !saveAs && current.filePath ? current.filePath : await pickNotebookTarget(state.doc.name);
    if (!path) return false;
    const connectionName =
      useConnectionsStore.getState().connections.find((c) => c.id === state.doc.connectionId)
        ?.name ?? null;
    await writeNotebookText(
      path,
      serializeNotebook({ ...state.doc, connectionName }, state.outputs),
    );
    useNotebookStore.getState().markSaved(path, state);
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
    const path = await pickExportTarget(doc.name, format);
    if (!path) return;
    const content =
      format === "md" ? notebookToMarkdown(doc, outputs) : notebookToHtml(doc, outputs);
    await writeNotebookText(path, content);
    toast.success("Notebook exportiert");
  } catch (error) {
    toast.error(`Export fehlgeschlagen: ${message(error)}`);
  }
}
