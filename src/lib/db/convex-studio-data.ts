import { invoke } from "./core";

export type ConvexDocument = Record<string, unknown> & { _id: string; _creationTime: number };

export interface ConvexDataTable {
  name: string;
  documents: number | null;
}

export interface ConvexDataTables {
  tables: ConvexDataTable[];
  has_more: boolean;
}

export interface ConvexDataPage {
  documents: ConvexDocument[];
  cursor: string | null;
  has_more: boolean;
}

export type ConvexFilterOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "type"
  | "notype"
  | "anyOf"
  | "noneOf";

export interface ConvexFilterClause {
  id: string;
  field: string;
  op: ConvexFilterOp;
  value: unknown;
  enabled: boolean;
}

export type ConvexIndexFilter =
  | { name: string; clauses: { type: "indexEq"; enabled: boolean; value: unknown }[] }
  | {
      name: string;
      search: string;
      clauses: { field: string; enabled: boolean; value: unknown }[];
    };

export interface ConvexFilterExpression {
  clauses: ConvexFilterClause[];
  order: "asc" | "desc";
  index?: ConvexIndexFilter;
}

export interface ConvexFieldValidator {
  fieldType: ConvexValidator;
  optional: boolean;
}

export type ConvexValidator = { type: string; value?: unknown; tableName?: string };

export interface ConvexSchemaTable {
  tableName: string;
  indexes: { indexDescriptor: string; fields: string[] }[];
  searchIndexes: { indexDescriptor: string; searchField: string; filterFields: string[] }[];
  vectorIndexes?: {
    indexDescriptor: string;
    vectorField: string;
    dimensions: number;
    filterFields: string[];
  }[];
  documentType: ConvexValidator | null;
}

export interface ConvexIndex {
  table: string;
  name: string;
  fields:
    | string[]
    | { searchField: string; filterFields: string[] }
    | { vectorField: string; dimensions: number; filterFields: string[] };
  backfill?: { state: string };
  staged?: boolean;
}

export interface ConvexDataSchema {
  has_schema: boolean;
  schema_validation: boolean;
  tables: ConvexSchemaTable[];
  indexes: ConvexIndex[];
}

export type ConvexImportFormat = "jsonLines" | "jsonArray" | "csv";
export type ConvexImportMode = "requireEmpty" | "append" | "replace";

interface Target {
  profileId: string;
  projectId: number;
  deploymentName: string;
}

const base = (target: Target) => ({
  id: target.profileId,
  projectId: target.projectId,
  deploymentName: target.deploymentName,
});

export const convexDataTables = (target: Target) =>
  invoke<ConvexDataTables>("convex_studio_data_tables", base(target));
export const convexDataDocuments = (
  target: Target,
  table: string,
  filter: ConvexFilterExpression | null,
  cursor: string | null,
  pageSize: number,
) =>
  invoke<ConvexDataPage>("convex_studio_data_documents", {
    ...base(target),
    table,
    filter,
    cursor,
    pageSize,
  });
export const convexDataResolve = (target: Target, documentId: string) =>
  invoke<{ table: string; document: ConvexDocument }>("convex_studio_data_resolve", {
    ...base(target),
    documentId,
  });
export const convexDataInsert = (target: Target, table: string, documents: unknown[]) =>
  invoke<number>("convex_studio_data_insert", { ...base(target), table, documents });
export const convexDataReplace = (target: Target, documentId: string, document: unknown) =>
  invoke<void>("convex_studio_data_replace", { ...base(target), documentId, document });
export const convexDataPatch = (target: Target, table: string, ids: string[], fields: unknown) =>
  invoke<void>("convex_studio_data_patch", { ...base(target), table, ids, fields });
export const convexDataDelete = (target: Target, table: string, ids: string[]) =>
  invoke<number>("convex_studio_data_delete", { ...base(target), table, ids });
export const convexDataClear = (target: Target, table: string) =>
  invoke<number>("convex_studio_data_clear", { ...base(target), table });
export const convexDataCreateTable = (target: Target, table: string) =>
  invoke<void>("convex_studio_data_create_table", { ...base(target), table });
export const convexDataDeleteTable = (target: Target, table: string) =>
  invoke<void>("convex_studio_data_delete_table", { ...base(target), table });
export const convexDataSchema = (target: Target) =>
  invoke<ConvexDataSchema>("convex_studio_data_schema", base(target));
export const convexDataInferSchema = (target: Target, table: string) =>
  invoke<string>("convex_studio_data_infer_schema", { ...base(target), table });
export const convexDataImport = (
  target: Target,
  table: string,
  format: ConvexImportFormat,
  mode: ConvexImportMode,
  content: string,
) => invoke<number>("convex_studio_data_import", { ...base(target), table, format, mode, content });
