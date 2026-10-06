import type { ExtensionContext, Json, L8dbApi, TableSnapshot } from "@l8db/extension-api";
import { assembleTableJson, type ColumnMapping, detectMapping, validMapping } from "./assemble";

const PANEL = "tablejson.document";
const ROLES: { role: keyof ColumnMapping; title: string; optional?: boolean }[] = [
  { role: "level", title: "Ebene / Verschachtelung" },
  { role: "position", title: "Positionsnummer / Reihenfolge" },
  { role: "name", title: "Name / JSON-Schlüssel" },
  { role: "value", title: "Wert / Inhalt" },
  { role: "content", title: "CLOB / Ersatz bei NULL", optional: true },
  { role: "group", title: "Dokument-ID / REF_KOPF", optional: true },
  { role: "container", title: "Unterknoten-Markierung / SUBTAG", optional: true },
];

function tableSnapshot(payload: Json | undefined): TableSnapshot {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("TableJSONViewer bitte in einer gefilterten Tabelle öffnen.");
  const table = payload as unknown as TableSnapshot;
  if (
    typeof table.connectionId !== "string" ||
    (table.database !== null && typeof table.database !== "string") ||
    typeof table.schema !== "string" ||
    typeof table.table !== "string" ||
    typeof table.filter !== "string" ||
    !Array.isArray(table.columns) ||
    !table.columns.every((column) => typeof column === "string") ||
    !Array.isArray(table.rows) ||
    table.rows.length > 50_000 ||
    !table.rows.every(
      (row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        table.columns.every((column) => row[column] === null || typeof row[column] === "string"),
    )
  )
    throw new Error("Ungültige Tabellendaten.");
  return table;
}

export function activate(context: ExtensionContext, api: L8dbApi) {
  const loadMappings = async () => {
    const value = await api.storage.get("mappings");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  };
  const tableKey = (table: TableSnapshot) =>
    JSON.stringify([table.connectionId, table.database, table.schema, table.table]);

  const pickMapping = async (table: TableSnapshot, current: ColumnMapping | null) => {
    const mapping = {} as Record<keyof ColumnMapping, string | null>;
    for (const { role, title, optional } of ROLES) {
      const items = [
        ...(optional ? [{ label: "Keine Spalte", description: "Nicht verwenden" }] : []),
        ...table.columns.map((column) => ({ label: column, picked: current?.[role] === column })),
      ];
      const picked = await api.window.showQuickPick(items, { title: `TableJSONViewer: ${title}` });
      if (!picked?.length) return null;
      const selected = typeof picked[0] === "string" ? picked[0] : picked[0].label;
      mapping[role] = optional && selected === "Keine Spalte" ? null : selected;
    }
    if (!validMapping(mapping, table.columns)) throw new Error("Ungültige Spaltenzuordnung.");
    const saved = await loadMappings();
    const key = tableKey(table);
    const entries = Object.entries(saved)
      .filter(([id]) => id !== key)
      .slice(-49);
    await api.storage.set("mappings", Object.fromEntries([...entries, [key, mapping]]) as Json);
    return mapping;
  };

  const show = async (payload: Json | undefined, configure: boolean) => {
    const table = tableSnapshot(payload);
    const saved = (await loadMappings())[tableKey(table)];
    const current = validMapping(saved, table.columns) ? saved : detectMapping(table.columns);
    const mapping = configure || !current ? await pickMapping(table, current) : current;
    if (!mapping) return;
    if (!table.rows.length) {
      await api.notifications.showInfo("Keine Zeilen für diesen Filter.");
      return;
    }
    const { value, documents } = assembleTableJson(table, mapping);
    await api.panels.openJson(PANEL, {
      text: JSON.stringify(value, null, 2),
      filename: table.table,
      description: `${table.schema}.${table.table} · ${table.rows.length} Zeilen · ${documents} Dokument${documents === 1 ? "" : "e"} · Filter: ${table.filter || "keiner"}`,
    });
  };

  context.subscriptions.push(
    api.commands.registerCommand("tablejson.show", (payload) => show(payload, false)),
    api.commands.registerCommand("tablejson.configure", (payload) => show(payload, true)),
  );
}
