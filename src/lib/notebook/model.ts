import type { BindParamType } from "@/lib/bind-params";
import { BIND_PARAM_TYPES } from "@/lib/bind-params";
import type { ResultChartState } from "@/lib/result-chart";

export interface NotebookVariable {
  name: string;
  type: BindParamType;
  value: string;
}

export interface NotebookOutput {
  columns: string[];
  rows: Record<string, unknown>[];
  rowsAffected: number | null;
  executionMs: number;
  notice?: string;
  error?: string;
  ranAt: number;
  totalRows?: number;
}

export type NotebookCell =
  | { id: string; type: "markdown"; source: string }
  | {
      id: string;
      type: "sql";
      source: string;
      connectionId?: string | null;
      chart?: ResultChartState;
    }
  | { id: string; type: "variables"; variables: NotebookVariable[] };

export type NotebookCellType = NotebookCell["type"];

export interface NotebookDoc {
  name: string;
  connectionId: string | null;
  connectionName?: string | null;
  saveResults: boolean;
  cells: NotebookCell[];
}

export interface NotebookFile extends NotebookDoc {
  format: "l8db-notebook";
  version: 1;
  outputs?: Record<string, NotebookOutput>;
}

export const NOTEBOOK_EXTENSION = "l8nb";
export const SAVED_ROWS_PER_CELL = 500;
export const SAVED_RESULTS_BYTES = 2_000_000;

export function cellId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function newCell(type: NotebookCellType): NotebookCell {
  if (type === "markdown") return { id: cellId(), type, source: "" };
  if (type === "variables")
    return { id: cellId(), type, variables: [{ name: "", type: "text", value: "" }] };
  return { id: cellId(), type, source: "" };
}

export function newNotebook(connectionId: string | null = null): NotebookDoc {
  return {
    name: "Neues Notebook",
    connectionId,
    saveResults: false,
    cells: [
      { id: cellId(), type: "markdown", source: "# Neues Notebook\n\nBeschreibung der Analyse." },
      { id: cellId(), type: "sql", source: "" },
    ],
  };
}

export function capOutputs(
  outputs: Record<string, NotebookOutput>,
  cells: NotebookCell[],
  rowsPerCell = SAVED_ROWS_PER_CELL,
  maxBytes = SAVED_RESULTS_BYTES,
): Record<string, NotebookOutput> {
  const result: Record<string, NotebookOutput> = {};
  let bytes = 0;
  for (const cell of cells) {
    const output = outputs[cell.id];
    if (cell.type !== "sql" || !output) continue;
    const capped: NotebookOutput = {
      ...output,
      rows: output.rows.slice(0, rowsPerCell),
      totalRows: output.totalRows ?? output.rows.length,
    };
    const size = JSON.stringify(capped).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    result[cell.id] = capped;
  }
  return result;
}

export function serializeNotebook(
  doc: NotebookDoc,
  outputs: Record<string, NotebookOutput>,
): string {
  const file: NotebookFile = {
    format: "l8db-notebook",
    version: 1,
    name: doc.name,
    connectionId: doc.connectionId,
    connectionName: doc.connectionName ?? null,
    saveResults: doc.saveResults,
    cells: doc.cells,
    ...(doc.saveResults ? { outputs: capOutputs(outputs, doc.cells) } : {}),
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function validCell(value: unknown): value is NotebookCell {
  const cell = value as NotebookCell;
  if (!cell || typeof cell.id !== "string") return false;
  if (cell.type === "markdown" || cell.type === "sql") return typeof cell.source === "string";
  if (cell.type === "variables")
    return (
      Array.isArray(cell.variables) &&
      cell.variables.every(
        (v) =>
          v &&
          typeof v.name === "string" &&
          typeof v.value === "string" &&
          BIND_PARAM_TYPES.includes(v.type),
      )
    );
  return false;
}

export function parseNotebook(text: string): {
  doc: NotebookDoc;
  outputs: Record<string, NotebookOutput>;
} {
  const value = JSON.parse(text) as NotebookFile;
  if (
    value?.format !== "l8db-notebook" ||
    value.version !== 1 ||
    !Array.isArray(value.cells) ||
    !value.cells.every(validCell)
  )
    throw new Error("Die Datei enthält kein gültiges l8db-Notebook.");
  const outputs: Record<string, NotebookOutput> = {};
  for (const [id, output] of Object.entries(value.outputs ?? {}))
    if (output && Array.isArray(output.columns) && Array.isArray(output.rows)) outputs[id] = output;
  return {
    doc: {
      name: typeof value.name === "string" ? value.name : "Notebook",
      connectionId: typeof value.connectionId === "string" ? value.connectionId : null,
      connectionName: typeof value.connectionName === "string" ? value.connectionName : null,
      saveResults: Boolean(value.saveResults),
      cells: value.cells,
    },
    outputs,
  };
}
