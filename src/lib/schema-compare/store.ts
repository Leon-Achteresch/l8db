import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { loadSchemaCatalog } from "@/lib/db";
import { ensurePassword } from "@/lib/password-prompt";
import { effectiveConnectionString, ensureSshTunnel } from "@/lib/ssh";
import { compareCatalogs, defaultSelection } from "./diff";
import {
  type CompareResult,
  type CompareSide,
  compareTypesFor,
  DEFAULT_COMPARE_OPTIONS,
  defaultCompareTypes,
  EMPTY_SIDE,
  type SchemaCompareOptions,
  type SelectableType,
} from "./types";

interface SchemaCompareState {
  source: CompareSide;
  target: CompareSide;
  types: SelectableType[] | null;
  options: SchemaCompareOptions;
  result: CompareResult | null;
  selection: Record<string, boolean>;
  activeKey: string | null;
  loading: string | null;
  error: string | null;
}

export const useSchemaCompareStore = create<SchemaCompareState>()(
  persist(
    (): SchemaCompareState => ({
      source: EMPTY_SIDE,
      target: EMPTY_SIDE,
      types: null,
      options: DEFAULT_COMPARE_OPTIONS,
      result: null,
      selection: {},
      activeKey: null,
      loading: null,
      error: null,
    }),
    {
      name: "l8db.schema-compare",
      partialize: (state) => ({
        source: state.source,
        target: state.target,
        types: state.types,
        options: state.options,
      }),
    },
  ),
);

export function connectionFor(side: CompareSide): SavedConnection | null {
  return (
    useConnectionsStore.getState().connections.find((item) => item.id === side.connectionId) ?? null
  );
}

export function sideLabel(side: CompareSide): string {
  const connection = connectionFor(side);
  return [connection?.name ?? "?", side.database, side.schema].filter(Boolean).join(" · ");
}

export async function prepareConnection(id: string): Promise<SavedConnection> {
  const find = () => useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!find()) throw new Error("Die Verbindung existiert nicht mehr.");
  if (!(await ensurePassword(id))) throw new Error("Ohne Passwort kann nicht verbunden werden.");
  const fresh = find();
  if (fresh?.ssh?.host && !fresh.tunnelPort) {
    const outcome = await ensureSshTunnel(fresh);
    if (!outcome.ok) throw new Error(outcome.error ?? "SSH-Tunnel konnte nicht geöffnet werden.");
  }
  const ready = find();
  if (!ready) throw new Error("Die Verbindung existiert nicht mehr.");
  return ready;
}

export function activeTypes(
  state: Pick<SchemaCompareState, "types">,
  kind: SavedConnection["kind"] | undefined,
) {
  const supported = compareTypesFor(kind);
  return (state.types ?? defaultCompareTypes(kind)).filter((type) => supported.includes(type));
}

export async function runSchemaCompare(): Promise<void> {
  const state = useSchemaCompareStore.getState();
  const set = useSchemaCompareStore.setState;
  const { source, target } = state;
  try {
    if (!source.connectionId || !source.schema || !target.connectionId || !target.schema)
      throw new Error("Bitte Quelle und Ziel vollständig auswählen.");
    if (
      source.connectionId === target.connectionId &&
      (source.database ?? "") === (target.database ?? "") &&
      source.schema === target.schema
    )
      throw new Error("Quelle und Ziel sind identisch.");
    set({ loading: "Verbindungen werden vorbereitet…", error: null });
    const left = await prepareConnection(source.connectionId);
    const right = await prepareConnection(target.connectionId);
    if (left.kind !== right.kind)
      throw new Error("Quelle und Ziel müssen dieselbe Datenbankart verwenden.");
    const types = activeTypes(state, left.kind);
    if (types.length === 0)
      throw new Error(
        "Für diese Datenbank ist der Schema-Vergleich nicht verfügbar oder es ist kein Objekttyp gewählt.",
      );
    set({ loading: "Objekte werden gelesen…" });
    const [sourceObjects, targetObjects] = await Promise.all([
      loadSchemaCatalog(
        left.kind,
        effectiveConnectionString(left),
        source.schema,
        types,
        source.database ?? undefined,
      ),
      loadSchemaCatalog(
        right.kind,
        effectiveConnectionString(right),
        target.schema,
        types,
        target.database ?? undefined,
      ),
    ]);
    set({ loading: "Unterschiede werden berechnet…" });
    const context = {
      kind: left.kind,
      sourceSchema: source.schema,
      targetSchema: target.schema,
      options: state.options,
    };
    const items = compareCatalogs(sourceObjects, targetObjects, context);
    set({
      result: {
        ...context,
        target,
        sourceLabel: sideLabel(source),
        targetLabel: sideLabel(target),
        types,
        items,
        comparedAt: new Date().toISOString(),
      },
      selection: defaultSelection(items),
      activeKey: null,
      loading: null,
    });
  } catch (error) {
    set({ loading: null, error: error instanceof Error ? error.message : String(error) });
  }
}
