import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export interface SchemaMapTable {
  name: string;
  rows: number | null;
  bytes: number | null;
  comment: string | null;
}

export interface SchemaMapLink {
  from: [string, string];
  to: [string, string];
}

export interface SchemaMap {
  tables: SchemaMapTable[];
  links: SchemaMapLink[];
}

export async function getSchemaMap(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  database?: string,
): Promise<SchemaMap> {
  return invoke("get_schema_map", { kind, connectionString, database, schema });
}
