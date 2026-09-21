import {
  formatSequenceDefinition,
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
  type SequenceInfo,
  versioningMetadata,
} from "@/lib/db";
import { packageOid } from "@/lib/plsql";
import { effectiveConnectionString } from "@/lib/ssh";
import { checksum, normalizeSource } from "./model";
import { oracleConstraintMetadataSql, portableOracleMetadata } from "./oracle-metadata";
import { requalify } from "./schema";
import type { ManagedObject, ObjectSnapshot } from "./types";

export async function captureObject(
  connection: SavedConnection,
  database: string | null,
  object: ManagedObject,
  targetSchema?: string | null,
  transaction?: string,
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
  const metadataRead = <T>(operation: string, fallback: () => Promise<T>): Promise<T> =>
    transaction ? versioningMetadata<T>(transaction, operation, schema, name) : fallback();
  let definition: string;
  if (side.objectType === "table") {
    const [columns, constraints, indexes, triggers] = await Promise.all([
      metadataRead("columns", () =>
        listTableColumnsDetailed(connection.kind, url, schema, name, db),
      ),
      metadataRead("constraints", () => listConstraints(connection.kind, url, schema, name, db)),
      metadataRead("indexes", () => listIndexes(connection.kind, url, schema, name, db)),
      metadataRead("triggers", () => listTriggers(connection.kind, url, schema, name, db)),
    ]);
    if (!columns.length) throw new Error(`Tabelle ${schema}.${name} fehlt oder ist nicht lesbar.`);
    const metadata =
      connection.kind === "oracle" && object.metadataVersion === 2
        ? await portableOracleMetadata(
            constraints,
            indexes,
            (
              await executeQuery(
                connection.kind,
                url,
                oracleConstraintMetadataSql(schema, name),
                db,
              )
            ).rows,
            schema,
            object.selection.schema ?? schema,
          )
        : { constraints, indexes };
    definition = formatTableDefinition({
      schema,
      table: name,
      columns,
      constraints: metadata.constraints,
      indexes: metadata.indexes,
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
  } else if (transaction) {
    if (side.objectType === "sequence") {
      const sequences = await versioningMetadata<SequenceInfo[]>(
        transaction,
        "sequences",
        schema,
        name,
      );
      const sequence = sequences.find((entry) => entry.name === name);
      if (!sequence) throw new Error(`Sequenz ${schema}.${name} fehlt.`);
      definition = formatSequenceDefinition(sequence);
    } else {
      definition = await versioningMetadata<string>(
        transaction,
        side.objectType === "materialized_view" ? "view" : side.objectType,
        schema,
        name,
      );
    }
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
  transaction?: string,
): Promise<ObjectSnapshot[]> {
  const result: ObjectSnapshot[] = [];
  for (const object of objects)
    result.push(await captureObject(connection, database, object, targetSchema, transaction));
  return result;
}
