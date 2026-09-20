import {
  formatTableDefinition,
  listCompareObjects,
  loadCompareDefinition,
} from "@/lib/compare-definition";
import type { SavedConnection } from "@/lib/connections";
import {
  executeQuery,
  getFunctionDefinition,
  listConstraints,
  listIndexes,
  listTableColumnsDetailed,
  listTriggers,
} from "@/lib/db";
import { packageOid } from "@/lib/plsql";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum, normalizeSource } from "./model";
import { requalify } from "./schema";
import type { ManagedObject, ObjectSnapshot } from "./types";

export async function captureObject(
  connection: SavedConnection,
  database: string | null,
  object: ManagedObject,
  targetSchema?: string | null,
): Promise<ObjectSnapshot> {
  const side = {
    ...object.selection,
    schema: targetSchema || object.selection.schema,
    connectionId: connection.id,
    database,
  };
  const schema = side.schema;
  const name = side.objectName;
  if (!schema || !name) throw new Error("Objektidentität ist unvollständig.");
  const url = effectiveConnectionString(connection);
  const db = database ?? undefined;
  let definition: string;
  if (side.objectType === "table") {
    const [columns, constraints, indexes, triggers] = await Promise.all([
      listTableColumnsDetailed(connection.kind, url, schema, name, db),
      listConstraints(connection.kind, url, schema, name, db),
      listIndexes(connection.kind, url, schema, name, db),
      listTriggers(connection.kind, url, schema, name, db),
    ]);
    if (!columns.length) throw new Error(`Tabelle ${schema}.${name} fehlt oder ist nicht lesbar.`);
    definition = formatTableDefinition({
      schema,
      table: name,
      columns,
      constraints,
      indexes,
      triggers,
    });
  } else if (side.objectType === "package") {
    const spec = await getFunctionDefinition(
      connection.kind,
      url,
      packageOid(schema, name, "spec"),
      db,
    );
    let body = "";
    try {
      body = await getFunctionDefinition(
        connection.kind,
        url,
        packageOid(schema, name, "body"),
        db,
      );
    } catch (error) {
      const exists = await executeQuery(
        connection.kind,
        url,
        `SELECT object_type FROM all_objects WHERE owner = '${schema.replaceAll("'", "''")}' AND object_name = '${name.replaceAll("'", "''")}' AND object_type = 'PACKAGE BODY'`,
        db,
      );
      if (exists.rows.length) throw error;
    }
    definition = [
      `PACKAGE SPEC ${schema}.${name}`,
      spec,
      `PACKAGE BODY ${schema}.${name}`,
      body,
    ].join("\n\n");
  } else {
    if (side.objectType === "routine" || side.objectType === "procedure") {
      const objects = await listCompareObjects(connection, side);
      const matches = objects.filter((entry) => entry.name === name);
      if (matches.length !== 1)
        throw new Error(`Routine ${schema}.${name} fehlt oder ist nicht eindeutig.`);
      side.objectOid = matches[0].oid;
    }
    definition = await loadCompareDefinition(connection, side);
  }
  if (!definition.trim())
    throw new Error(`${schema}.${name}: Definition ist leer oder nicht lesbar.`);
  definition = normalizeSource(requalify(definition, schema, object.selection.schema ?? schema));
  return { object, definition, checksum: await checksum(definition) };
}

export async function captureObjects(
  connection: SavedConnection,
  database: string | null,
  objects: ManagedObject[],
  targetSchema?: string | null,
): Promise<ObjectSnapshot[]> {
  const result: ObjectSnapshot[] = [];
  for (const object of objects)
    result.push(await captureObject(connection, database, object, targetSchema));
  return result;
}
