import { invoke } from "./core";

export type StudioTableKind =
  | "table"
  | "partitioned_table"
  | "view"
  | "materialized_view"
  | "foreign_table"
  | "unknown";

export interface StudioTable {
  schema: string;
  name: string;
  kind: StudioTableKind;
  rls_enabled: boolean;
  estimated_rows: number | null;
}

export interface StudioTablesPage {
  tables: StudioTable[];
  has_more: boolean;
}

export interface StudioColumn {
  name: string;
  data_type: string;
  nullable: boolean;
  default_value: string | null;
  is_primary_key: boolean;
  is_unique: boolean;
  is_identity: boolean;
  is_generated: boolean;
  enum_values: string[] | null;
}

export interface StudioForeignKey {
  name: string;
  definition: string;
  foreign_schema: string;
  foreign_table: string;
}

export interface StudioIndex {
  name: string;
  definition: string;
  is_unique: boolean;
  is_primary: boolean;
}

export interface StudioTableInfo {
  schema: string;
  name: string;
  kind: StudioTableKind;
  rls_enabled: boolean | null;
  columns: StudioColumn[];
  foreign_keys: StudioForeignKey[];
  indexes: StudioIndex[];
  view_definition: string | null;
  introspected: boolean;
}

export type StudioFilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "gt"
  | "lte"
  | "gte"
  | "like"
  | "ilike"
  | "is_null"
  | "not_null"
  | "in";

export interface StudioRowFilter {
  column: string;
  operator: StudioFilterOperator;
  value: string | null;
}

export interface StudioRowQuery {
  offset: number;
  sort_column: string | null;
  sort_desc: boolean;
  filters: StudioRowFilter[];
}

export type StudioRow = Record<string, unknown>;

export interface StudioRowsPage {
  rows: StudioRow[];
  has_more: boolean;
}

export interface StudioColumnDefinition {
  name: string;
  data_type: string;
  default_value: string | null;
  nullable: boolean;
  unique: boolean;
  primary_key: boolean;
  identity: boolean;
}

export interface StudioTableDefinition {
  schema: string;
  name: string;
  columns: StudioColumnDefinition[];
  enable_rls: boolean;
}

export interface StudioColumnChange {
  new_name: string | null;
  data_type: string | null;
  default_value: string | null;
  drop_default: boolean;
  nullable: boolean | null;
}

export const studioTablesSchemas = (reference: string) =>
  invoke<string[]>("supabase_studio_tables_schemas", { reference });

export const studioTablesList = (
  reference: string,
  schema: string,
  search: string,
  offset: number,
) => invoke<StudioTablesPage>("supabase_studio_tables_list", { reference, schema, search, offset });

export const studioTablesDescribe = (reference: string, schema: string, table: string) =>
  invoke<StudioTableInfo>("supabase_studio_tables_describe", { reference, schema, table });

export const studioTablesRows = (
  reference: string,
  schema: string,
  table: string,
  query: StudioRowQuery,
) => invoke<StudioRowsPage>("supabase_studio_tables_rows", { reference, schema, table, query });

export const studioTablesInsertRow = (
  reference: string,
  schema: string,
  table: string,
  values: StudioRow,
) => invoke<StudioRow>("supabase_studio_tables_insert_row", { reference, schema, table, values });

export const studioTablesUpdateRow = (
  reference: string,
  schema: string,
  table: string,
  key: StudioRow,
  values: StudioRow,
) =>
  invoke<StudioRow>("supabase_studio_tables_update_row", {
    reference,
    schema,
    table,
    key,
    values,
  });

export const studioTablesDeleteRows = (
  reference: string,
  schema: string,
  table: string,
  keys: StudioRow[],
) => invoke<number>("supabase_studio_tables_delete_rows", { reference, schema, table, keys });

export const studioTablesCreateTable = (reference: string, definition: StudioTableDefinition) =>
  invoke<void>("supabase_studio_tables_create_table", { reference, definition });

export const studioTablesRenameTable = (
  reference: string,
  schema: string,
  table: string,
  newName: string,
) => invoke<void>("supabase_studio_tables_rename_table", { reference, schema, table, newName });

export const studioTablesDropTable = (
  reference: string,
  schema: string,
  table: string,
  kind: StudioTableKind,
  cascade: boolean,
) => invoke<void>("supabase_studio_tables_drop_table", { reference, schema, table, kind, cascade });

export const studioTablesTruncate = (
  reference: string,
  schema: string,
  table: string,
  restartIdentity: boolean,
  cascade: boolean,
) =>
  invoke<void>("supabase_studio_tables_truncate", {
    reference,
    schema,
    table,
    restartIdentity,
    cascade,
  });

export const studioTablesSetRls = (
  reference: string,
  schema: string,
  table: string,
  enabled: boolean,
) => invoke<void>("supabase_studio_tables_set_rls", { reference, schema, table, enabled });

export const studioTablesAddColumn = (
  reference: string,
  schema: string,
  table: string,
  column: StudioColumnDefinition,
) => invoke<void>("supabase_studio_tables_add_column", { reference, schema, table, column });

export const studioTablesAlterColumn = (
  reference: string,
  schema: string,
  table: string,
  column: string,
  change: StudioColumnChange,
) =>
  invoke<void>("supabase_studio_tables_alter_column", {
    reference,
    schema,
    table,
    column,
    change,
  });

export const studioTablesDropColumn = (
  reference: string,
  schema: string,
  table: string,
  column: string,
  cascade: boolean,
) =>
  invoke<void>("supabase_studio_tables_drop_column", {
    reference,
    schema,
    table,
    column,
    cascade,
  });
