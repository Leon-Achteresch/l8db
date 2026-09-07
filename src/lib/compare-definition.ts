import type { CompareSideSelection } from "@/lib/compare-types";
import type { SavedConnection } from "@/lib/connections";
import {
  type ConstraintInfo,
  type DetailedColumnInfo,
  type FunctionInfo,
  getFunctionDefinition,
  getViewDefinition,
  type IndexInfo,
  listConstraints,
  listFunctions,
  listIndexes,
  listMaterializedViews,
  listProcedures,
  listSequences,
  listTableColumnsDetailed,
  listTables,
  listTriggers,
  listViews,
  type SequenceInfo,
  type TriggerInfo,
} from "@/lib/db";
import { packageOid } from "@/lib/plsql";
import { effectiveConnectionString } from "@/lib/ssh";

export {
  COMPARE_OBJECT_LABELS,
  EMPTY_COMPARE_SIDE,
  supportedCompareObjectTypes,
  type CompareObjectType,
  type CompareSideSelection,
} from "@/lib/compare-types";

export function routineLabel(routine: FunctionInfo): string {
  return `${routine.name}(${routine.identity_args})`;
}

export function formatTableDefinition(input: {
  schema: string;
  table: string;
  columns: DetailedColumnInfo[];
  constraints: ConstraintInfo[];
  indexes: IndexInfo[];
  triggers: TriggerInfo[];
}): string {
  const columns = [...input.columns].sort((a, b) => a.ordinal_position - b.ordinal_position);
  const lines = [
    `TABLE ${input.schema}.${input.table}`,
    "COLUMNS",
    ...columns.map((column) => {
      const nulls = column.is_nullable ? "NULL" : "NOT NULL";
      const fallback = column.column_default ? ` DEFAULT ${column.column_default}` : "";
      const key = column.is_primary_key ? " PRIMARY KEY" : "";
      const width = column.character_maximum_length
        ? `(${column.character_maximum_length})`
        : "";
      return `  ${column.name} ${column.data_type}${width} ${nulls}${fallback}${key}`;
    }),
  ];
  if (input.constraints.length > 0) {
    lines.push("CONSTRAINTS");
    for (const constraint of [...input.constraints].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(
        `  ${constraint.name} ${constraint.constraint_type} (${constraint.columns.join(", ")}) ${constraint.definition}`.trim(),
      );
    }
  }
  if (input.indexes.length > 0) {
    lines.push("INDEXES");
    for (const index of [...input.indexes].sort((a, b) => a.name.localeCompare(b.name))) {
      lines.push(`  ${index.definition || `${index.name} ${index.columns.join(", ")}`}`);
    }
  }
  if (input.triggers.length > 0) {
    lines.push("TRIGGERS");
    for (const trigger of [...input.triggers].sort((a, b) =>
      a.trigger_name.localeCompare(b.trigger_name),
    )) {
      lines.push(
        `  ${trigger.definition || `${trigger.timing} ${trigger.event} ${trigger.trigger_name}`}`,
      );
    }
  }
  return lines.join("\n");
}

export function formatSequenceDefinition(sequence: SequenceInfo): string {
  return [
    `SEQUENCE ${sequence.schema}.${sequence.name}`,
    `  data_type ${sequence.data_type}`,
    `  start ${sequence.start_value}`,
    `  min ${sequence.min_value}`,
    `  max ${sequence.max_value}`,
    `  increment ${sequence.increment_by}`,
    `  cycle ${sequence.cycle ? "YES" : "NO"}`,
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function optional<T>(run: Promise<T>, fallback: T): Promise<T> {
  try {
    return await run;
  } catch {
    return fallback;
  }
}

export async function loadCompareDefinition(
  connection: SavedConnection,
  side: CompareSideSelection,
): Promise<string> {
  if (!side.schema) return "";
  const url = effectiveConnectionString(connection);
  const database = side.database ?? undefined;
  const schema = side.schema;

  if (side.objectType === "view") {
    if (!side.objectName) return "";
    return getViewDefinition(connection.kind, url, schema, side.objectName, database);
  }

  if (side.objectType === "materialized_view") {
    if (!side.objectName) return "";
    const views = await listMaterializedViews(connection.kind, url, database, schema);
    const match = views.find((item) => item.name === side.objectName);
    if (match?.definition) return match.definition;
    return getViewDefinition(connection.kind, url, schema, side.objectName, database);
  }

  if (side.objectType === "routine" || side.objectType === "procedure") {
    if (!side.objectOid) return "";
    return getFunctionDefinition(connection.kind, url, side.objectOid, database);
  }

  if (side.objectType === "package") {
    if (!side.objectName) return "";
    const spec = await getFunctionDefinition(
      connection.kind,
      url,
      packageOid(schema, side.objectName, "spec"),
      database,
    );
    const body = await optional(
      getFunctionDefinition(
        connection.kind,
        url,
        packageOid(schema, side.objectName, "body"),
        database,
      ),
      "",
    );
    return [
      `PACKAGE SPEC ${schema}.${side.objectName}`,
      spec,
      `PACKAGE BODY ${schema}.${side.objectName}`,
      body,
    ]
      .filter((part) => part.length > 0)
      .join("\n\n");
  }

  if (side.objectType === "sequence") {
    if (!side.objectName) return "";
    const sequences = await listSequences(connection.kind, url, database, schema);
    const match = sequences.find((item) => item.name === side.objectName);
    if (!match) throw new Error(`Sequenz ${schema}.${side.objectName} nicht gefunden.`);
    return formatSequenceDefinition(match);
  }

  if (side.objectType === "table") {
    if (!side.objectName) return "";
    const table = side.objectName;
    const [columns, constraints, indexes, triggers] = await Promise.all([
      listTableColumnsDetailed(connection.kind, url, schema, table, database),
      optional(listConstraints(connection.kind, url, schema, table, database), []),
      optional(listIndexes(connection.kind, url, schema, table, database), []),
      optional(listTriggers(connection.kind, url, schema, table, database), []),
    ]);
    if (columns.length === 0) {
      throw new Error(`Tabelle ${schema}.${table} hat keine Spalten oder existiert nicht.`);
    }
    return formatTableDefinition({ schema, table, columns, constraints, indexes, triggers });
  }

  return "";
}

export async function listCompareObjects(
  connection: SavedConnection,
  side: CompareSideSelection,
): Promise<{ name: string; oid: string | null }[]> {
  if (!side.schema) return [];
  const url = effectiveConnectionString(connection);
  const database = side.database ?? undefined;
  const schema = side.schema;
  switch (side.objectType) {
    case "table":
      return (await listTables(connection.kind, url, database, schema)).map((item) => ({
        name: item.name,
        oid: null,
      }));
    case "view":
      return (await listViews(connection.kind, url, database, schema)).map((item) => ({
        name: item.name,
        oid: null,
      }));
    case "materialized_view":
      return (await listMaterializedViews(connection.kind, url, database, schema)).map((item) => ({
        name: item.name,
        oid: null,
      }));
    case "routine":
      return (await listFunctions(connection.kind, url, database, schema))
        .filter((item) => item.return_type !== "PACKAGE")
        .map((item) => ({ name: routineLabel(item), oid: item.oid }));
    case "procedure":
      return (await listProcedures(connection.kind, url, database, schema)).map((item) => ({
        name: routineLabel(item),
        oid: item.oid,
      }));
    case "package":
      return (await listFunctions(connection.kind, url, database, schema))
        .filter((item) => item.return_type === "PACKAGE")
        .map((item) => ({ name: item.name, oid: null }));
    case "sequence":
      return (await listSequences(connection.kind, url, database, schema)).map((item) => ({
        name: item.name,
        oid: null,
      }));
    default:
      return [];
  }
}

export function compareLoadErrorMessage(error: unknown): string {
  return errorMessage(error);
}
