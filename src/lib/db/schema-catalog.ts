import { invoke } from "./core";
import type { DatabaseKind } from "./providers";

export type CatalogObjectType =
  | "table"
  | "column"
  | "constraint"
  | "index"
  | "trigger"
  | "view"
  | "materialized_view"
  | "sequence"
  | "function"
  | "procedure"
  | "package"
  | "package_body"
  | "type"
  | "type_body"
  | "synonym"
  | "comment"
  | "grant";

export interface CatalogObject {
  object_type: CatalogObjectType;
  name: string;
  parent: string | null;
  ddl: string;
  attributes: Record<string, string>;
}

export async function loadSchemaCatalog(
  kind: DatabaseKind,
  connectionString: string,
  schema: string,
  types: CatalogObjectType[],
  database?: string,
): Promise<CatalogObject[]> {
  return invoke("schema_catalog", { kind, connectionString, database, schema, types });
}
