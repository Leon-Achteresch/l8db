import { cellId, type NotebookCell } from "@/lib/notebook/model";
import { useNotebookStore } from "@/lib/notebook/store";

const MAX_CELLS = 40;

export interface ChatNotebookAnswer {
  ok: boolean;
  text: string;
}

export function notebookCells(value: unknown): NotebookCell[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CELLS) return null;
  const cells: NotebookCell[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const { type, source } = entry as Record<string, unknown>;
    if ((type !== "markdown" && type !== "sql") || typeof source !== "string") return null;
    cells.push(
      type === "sql"
        ? { id: cellId(), type, source, connectionId: null }
        : { id: cellId(), type, source },
    );
  }
  return cells;
}

export async function handleChatNotebookRequest(
  details: unknown,
  show: () => Promise<unknown>,
): Promise<ChatNotebookAnswer> {
  const args = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
  const cells = notebookCells(args.cells);
  if (!cells)
    return {
      ok: false,
      text: `cells braucht 1 bis ${MAX_CELLS} Zellen mit type markdown oder sql und source.`,
    };
  const store = useNotebookStore.getState();
  if (store.dirty)
    return {
      ok: false,
      text: "Im Notebook sind ungespeicherte Änderungen offen. Den Benutzer bitten, sie zu speichern oder zu verwerfen, und danach erneut anlegen.",
    };
  const name =
    typeof args.name === "string" && args.name.trim()
      ? args.name.trim().slice(0, 120)
      : "KI-Untersuchung";
  const connectionId = typeof args.connectionId === "string" ? args.connectionId : null;
  store.load({ name, connectionId, saveResults: false, cells }, {}, null);
  store.patchDoc({});
  await show();
  const queries = cells.filter((cell) => cell.type === "sql").length;
  return {
    ok: true,
    text: `Notebook "${name}" mit ${cells.length} Zellen (${queries} SQL) geöffnet. Der Benutzer führt die Zellen aus und speichert es.`,
  };
}
