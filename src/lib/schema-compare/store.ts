import { readTextFile } from "@tauri-apps/plugin-fs";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type SavedConnection, useConnectionsStore, usesTunnel } from "@/lib/connections";
import {
  type CatalogObject,
  type CatalogObjectType,
  type DatabaseKind,
  executeQuery,
  loadPartitionDdl,
  loadSchemaCatalog,
} from "@/lib/db";
import { ensurePassword } from "@/lib/password-prompt";
import {
  buildCatalogSnapshot,
  type CatalogSnapshot,
  parseCatalogSnapshot,
} from "@/lib/schema-snapshot";
import { effectiveConnectionString, ensureSshTunnel } from "@/lib/ssh";
import {
  compareCatalogs,
  defaultSelection,
  limitDifferences,
  markMissingTablespaces,
} from "./diff";
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
  renames: Record<string, string>;
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
      renames: {},
      activeKey: null,
      loading: null,
      error: null,
    }),
    {
      name: "l8db.schema-compare",
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<SchemaCompareState>;
        return {
          ...current,
          ...saved,
          options: { ...DEFAULT_COMPARE_OPTIONS, ...saved.options },
        };
      },
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

export function sideKind(side: CompareSide): DatabaseKind | undefined {
  return side.snapshot?.kind ?? connectionFor(side)?.kind;
}

export function snapshotFileLabel(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

export function sideLabel(side: CompareSide): string {
  if (side.snapshot)
    return [`Snapshot ${snapshotFileLabel(side.snapshot.path)}`, side.schema]
      .filter(Boolean)
      .join(" · ");
  const connection = connectionFor(side);
  return [connection?.name ?? "?", side.database, side.schema].filter(Boolean).join(" · ");
}

export async function prepareConnection(id: string): Promise<SavedConnection> {
  const find = () => useConnectionsStore.getState().connections.find((entry) => entry.id === id);
  if (!find()) throw new Error("Die Verbindung existiert nicht mehr.");
  if (!(await ensurePassword(id))) throw new Error("Ohne Passwort kann nicht verbunden werden.");
  const fresh = find();
  if (usesTunnel(fresh) && !fresh.tunnelPort) {
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

export function pickSchema(
  schemas: string[],
  current: string | null,
  preferred: string | null,
): string | null {
  if (current && schemas.includes(current)) return current;
  if (schemas.length === 1) return schemas[0];
  if (preferred && schemas.includes(preferred)) return preferred;
  return null;
}

export function sameSide(a: CompareSide, b: CompareSide): boolean {
  return (
    a.connectionId === b.connectionId &&
    (a.database ?? "") === (b.database ?? "") &&
    a.schema === b.schema &&
    (a.snapshot?.path ?? "") === (b.snapshot?.path ?? "")
  );
}

export function setupProblem(
  source: CompareSide,
  target: CompareSide,
  types: SelectableType[],
): string | null {
  const left = sideKind(source);
  const right = sideKind(target);
  if (!left) return "Quelle: Verbindung wählen.";
  if (!source.schema) return "Quelle: Schema wählen.";
  if (!right) return "Ziel: Verbindung wählen.";
  if (!target.schema) return "Ziel: Schema wählen.";
  if (left !== right)
    return "Quelle und Ziel müssen dieselbe Datenbankart verwenden (z. B. beide Oracle).";
  if (sameSide(source, target))
    return "Quelle und Ziel sind identisch. Bitte ein anderes Schema wählen.";
  if (types.length === 0) return "Mindestens einen Objekttyp wählen.";
  return null;
}

export async function readCatalogSnapshot(path: string): Promise<CatalogSnapshot> {
  return parseCatalogSnapshot(await readTextFile(path));
}

function inTypes(object: CatalogObject, types: readonly CatalogObjectType[]): boolean {
  return (
    types.includes(object.object_type) ||
    (object.object_type === "column" && types.includes("table"))
  );
}

async function addPartitionDdl(
  connection: SavedConnection,
  side: CompareSide,
  objects: CatalogObject[],
  tables: CatalogObject[],
): Promise<void> {
  if (tables.length === 0) return;
  const clauses = await loadPartitionDdl(
    connection.kind,
    effectiveConnectionString(connection),
    side.schema ?? "",
    tables.map((object) => object.name),
    side.database ?? undefined,
  ).catch((): Record<string, string> => ({}));
  for (const object of objects)
    if (tables.includes(object) && clauses[object.name])
      object.ddl = `${object.ddl}\n${clauses[object.name]}`;
}

const unpartitioned = (object: CatalogObject) =>
  object.object_type === "table" &&
  object.attributes.partitioned === "YES" &&
  !/PARTITION BY/i.test(object.ddl);

export async function captureCatalogSnapshot(side: CompareSide): Promise<CatalogSnapshot> {
  if (!side.connectionId || !side.schema) throw new Error("Bitte Verbindung und Schema wählen.");
  const connection = await prepareConnection(side.connectionId);
  const types = compareTypesFor(connection.kind);
  if (types.length === 0)
    throw new Error("Für diese Datenbank sind Katalog-Snapshots nicht verfügbar.");
  const objects = await loadSchemaCatalog(
    connection.kind,
    effectiveConnectionString(connection),
    side.schema,
    types,
    side.database ?? undefined,
  );
  await addPartitionDdl(connection, side, objects, objects.filter(unpartitioned));
  return buildCatalogSnapshot(
    {
      kind: connection.kind,
      connection_name: connection.name,
      database: side.database,
      schema: side.schema,
      types,
    },
    objects,
  );
}

async function targetTablespaces(connection: SavedConnection, side: CompareSide) {
  const result = await executeQuery(
    connection.kind,
    effectiveConnectionString(connection),
    "SELECT tablespace_name FROM user_tablespaces",
    side.database ?? undefined,
    { confirmed: true, track: false },
  );
  return new Set(result.rows.map((row) => String(Object.values(row)[0] ?? "")));
}

export async function runSchemaCompare(sides?: {
  source: CompareSide;
  target: CompareSide;
}): Promise<void> {
  const state = useSchemaCompareStore.getState();
  const set = useSchemaCompareStore.setState;
  const { source, target } = sides ?? state;
  try {
    if (
      (!source.connectionId && !source.snapshot) ||
      !source.schema ||
      (!target.connectionId && !target.snapshot) ||
      !target.schema
    )
      throw new Error("Bitte Quelle und Ziel vollständig auswählen.");
    if (sameSide(source, target)) throw new Error("Quelle und Ziel sind identisch.");
    set({ loading: "Verbindungen werden vorbereitet…", error: null });
    const open = async (side: CompareSide) =>
      side.snapshot
        ? { snapshot: await readCatalogSnapshot(side.snapshot.path), connection: null }
        : { snapshot: null, connection: await prepareConnection(side.connectionId ?? "") };
    const left = await open(source);
    const right = await open(target);
    const kind = left.snapshot?.kind ?? left.connection?.kind;
    if (!kind || kind !== (right.snapshot?.kind ?? right.connection?.kind))
      throw new Error("Quelle und Ziel müssen dieselbe Datenbankart verwenden.");
    const types = activeTypes(state, kind).filter(
      (type) =>
        (!left.snapshot || left.snapshot.types.includes(type)) &&
        (!right.snapshot || right.snapshot.types.includes(type)),
    );
    if (types.length === 0)
      throw new Error(
        left.snapshot || right.snapshot
          ? "Der Snapshot enthält keinen der gewählten Objekttypen."
          : "Für diese Datenbank ist der Schema-Vergleich nicht verfügbar oder es ist kein Objekttyp gewählt.",
      );
    set({ loading: "Objekte werden gelesen…" });
    const load = (side: CompareSide, opened: typeof left) =>
      opened.snapshot
        ? Promise.resolve(opened.snapshot.objects.filter((object) => inTypes(object, types)))
        : loadSchemaCatalog(
            kind,
            effectiveConnectionString(opened.connection as SavedConnection),
            side.schema ?? "",
            types,
            side.database ?? undefined,
          );
    const [sourceObjects, targetObjects] = await Promise.all([
      load(source, left),
      load(target, right),
    ]);
    const targetTables = new Set(
      targetObjects.filter((object) => object.object_type === "table").map((object) => object.name),
    );
    const missing = sourceObjects.filter(
      (object) => unpartitioned(object) && !targetTables.has(object.name),
    );
    if (left.connection && missing.length > 0) {
      set({ loading: "Partitionierung wird gelesen…" });
      await addPartitionDdl(left.connection, source, sourceObjects, missing);
    }
    set({ loading: "Unterschiede werden berechnet…" });
    const context = {
      kind,
      sourceSchema: left.snapshot?.schema ?? source.schema,
      targetSchema: right.snapshot?.schema ?? target.schema,
      options: state.options,
    };
    const items = compareCatalogs(sourceObjects, targetObjects, context);
    if (kind === "oracle" && !state.options.ignoreTablespace && right.connection) {
      const available = await targetTablespaces(right.connection, target).catch(() => null);
      if (available) markMissingTablespaces(items, available);
    }
    const limited = limitDifferences(items, state.options.diffLimit);
    set({
      source,
      target,
      result: {
        ...context,
        source,
        target,
        sourceLabel: sideLabel(source),
        targetLabel: sideLabel(target),
        types,
        items: limited.items,
        comparedAt: new Date().toISOString(),
        omitted: limited.omitted,
      },
      selection: defaultSelection(limited.items),
      renames: {},
      activeKey: null,
      loading: null,
    });
  } catch (error) {
    set({ loading: null, error: error instanceof Error ? error.message : String(error) });
  }
}

export function toggleRename(sourceKey: string, targetKey: string, enabled: boolean): void {
  useSchemaCompareStore.setState((state) => {
    const renames = Object.fromEntries(
      Object.entries(state.renames).filter(([from, to]) => from !== sourceKey && to !== targetKey),
    );
    if (!enabled) return { renames };
    return {
      renames: { ...renames, [sourceKey]: targetKey },
      selection: { ...state.selection, [sourceKey]: true, [targetKey]: true },
    };
  });
}

export function reverseSchemaCompare(): Promise<void> {
  const { result, source, target } = useSchemaCompareStore.getState();
  return runSchemaCompare({
    source: result?.target ?? target,
    target: result?.source ?? source,
  });
}
