import { type FormColumn, nextId, templateType } from "@/features/tables/create-table-view/columns";
import {
  type DatabaseKind,
  getTableRls,
  listConstraints,
  listForeignKeys,
  listTableColumnsDetailed,
  listTriggers,
} from "@/lib/db";
import type { useActiveCapabilities } from "@/lib/db-selection";

export async function loadTemplateColumns(
  kind: DatabaseKind,
  connectionString: string,
  database: string | null,
  sourceSchema: string,
  source: string,
  capabilities: ReturnType<typeof useActiveCapabilities>,
): Promise<{ mapped: FormColumn[]; notes: string[] } | null> {
  const detailed = await listTableColumnsDetailed(
    kind,
    connectionString,
    sourceSchema,
    source,
    database ?? undefined,
  );
  if (detailed.length === 0) {
    return null;
  }
  const constraints = capabilities.constraints
    ? await listConstraints(
        kind,
        connectionString,
        sourceSchema,
        source,
        database ?? undefined,
      ).catch(() => [])
    : [];
  const uniqueSingle = new Set(
    constraints
      .filter((c) => c.constraint_type.toUpperCase().includes("UNIQUE") && c.columns.length === 1)
      .map((c) => c.columns[0]),
  );
  const notes: string[] = ["Zeilen und Tabellendaten werden nicht kopiert."];
  const droppedDefaults: string[] = [];

  const mapped: FormColumn[] = [...detailed]
    .sort((a, b) => a.ordinal_position - b.ordinal_position)
    .map((col) => {
      const rawDefault = col.column_default;
      const sequenceBound = Boolean(rawDefault && /nextval\s*\(/i.test(rawDefault));
      if (sequenceBound && rawDefault) droppedDefaults.push(`${col.name} (${rawDefault})`);
      return {
        id: nextId(),
        name: col.name,
        data_type: templateType(col.data_type, col.character_maximum_length),
        is_nullable: col.is_nullable,
        default_value: sequenceBound ? null : (rawDefault ?? null),
        is_primary_key: col.is_primary_key,
        is_unique: !col.is_primary_key && uniqueSingle.has(col.name),
      };
    });

  if (droppedDefaults.length > 0) {
    notes.push(
      `An die Quelltabelle gebundene Sequenz-Defaults nicht übernommen: ${droppedDefaults.join(", ")}.`,
    );
  }

  const otherConstraints = constraints.filter((c) => {
    const type = c.constraint_type.toUpperCase();
    if (type.includes("PRIMARY")) return false;
    if (type.includes("UNIQUE") && c.columns.length === 1) return false;
    return true;
  });
  if (otherConstraints.length > 0) {
    notes.push(
      `Constraints nicht übernommen: ${otherConstraints.map((c) => `${c.name} (${c.constraint_type})`).join(", ")}.`,
    );
  }

  if (capabilities.foreign_keys) {
    const fks = await listForeignKeys(
      kind,
      connectionString,
      sourceSchema,
      source,
      database ?? undefined,
    ).catch(() => []);
    if (fks.length > 0) {
      notes.push(
        `Fremdschlüssel nicht übernommen: ${[...new Set(fks.map((f) => f.constraint_name))].join(", ")}.`,
      );
    }
  }

  if (capabilities.triggers) {
    const triggers = await listTriggers(
      kind,
      connectionString,
      sourceSchema,
      source,
      database ?? undefined,
    ).catch(() => []);
    if (triggers.length > 0) {
      notes.push(`Trigger nicht übernommen: ${triggers.map((t) => t.trigger_name).join(", ")}.`);
    }
  }

  if (capabilities.rls) {
    const rls = await getTableRls(
      kind,
      connectionString,
      sourceSchema,
      source,
      database ?? undefined,
    ).catch(() => null);
    if (rls?.rls_enabled) {
      notes.push(
        `RLS und ${rls.policies.length} Policy/Policies der Quelltabelle werden nicht übernommen.`,
      );
    }
  }

  notes.push("Indizes, Kommentare und Partitionierung werden nicht übernommen.");
  return { mapped, notes };
}
