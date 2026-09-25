import type { CatalogObject, CatalogObjectType, DatabaseKind } from "@/lib/db";

export type SelectableType = Exclude<CatalogObjectType, "column">;

export type DiffStatus = "only_source" | "only_target" | "different" | "identical";

export interface SchemaCompareOptions {
  ignoreWhitespace: boolean;
  ignoreCase: boolean;
  ignoreSystemNames: boolean;
  ignoreSequenceValues: boolean;
}

export const DEFAULT_COMPARE_OPTIONS: SchemaCompareOptions = {
  ignoreWhitespace: true,
  ignoreCase: false,
  ignoreSystemNames: true,
  ignoreSequenceValues: true,
};

export interface CompareSide {
  connectionId: string | null;
  database: string | null;
  schema: string | null;
}

export const EMPTY_SIDE: CompareSide = { connectionId: null, database: null, schema: null };

export interface DiffItem {
  key: string;
  type: CatalogObjectType;
  name: string;
  parent: string | null;
  status: DiffStatus;
  source: CatalogObject | null;
  target: CatalogObject | null;
  differsBy: string[];
  children: CatalogObject[];
}

export interface CompareContext {
  kind: DatabaseKind;
  sourceSchema: string;
  targetSchema: string;
  options: SchemaCompareOptions;
}

export interface CompareResult extends CompareContext {
  source: CompareSide;
  target: CompareSide;
  sourceLabel: string;
  targetLabel: string;
  types: SelectableType[];
  items: DiffItem[];
  comparedAt: string;
}

export const OBJECT_TYPE_META: Record<CatalogObjectType, { label: string; plural: string }> = {
  table: { label: "Tabelle", plural: "Tabellen" },
  column: { label: "Spalte", plural: "Spalten" },
  constraint: { label: "Constraint", plural: "Constraints" },
  index: { label: "Index", plural: "Indizes" },
  trigger: { label: "Trigger", plural: "Trigger" },
  view: { label: "View", plural: "Views" },
  materialized_view: { label: "Materialized View", plural: "Materialized Views" },
  sequence: { label: "Sequenz", plural: "Sequenzen" },
  function: { label: "Funktion", plural: "Funktionen" },
  procedure: { label: "Prozedur", plural: "Prozeduren" },
  package: { label: "Package", plural: "Packages" },
  package_body: { label: "Package Body", plural: "Package Bodies" },
  type: { label: "Typ", plural: "Typen" },
  type_body: { label: "Type Body", plural: "Type Bodies" },
  synonym: { label: "Synonym", plural: "Synonyme" },
  comment: { label: "Kommentar", plural: "Kommentare" },
  grant: { label: "Grant", plural: "Grants" },
};

export const TYPE_ORDER: CatalogObjectType[] = [
  "table",
  "column",
  "constraint",
  "index",
  "trigger",
  "view",
  "materialized_view",
  "sequence",
  "type",
  "type_body",
  "function",
  "procedure",
  "package",
  "package_body",
  "synonym",
  "comment",
  "grant",
];

export const STATUS_LABEL: Record<DiffStatus, string> = {
  only_source: "Nur in Quelle",
  only_target: "Nur im Ziel",
  different: "Unterschiedlich",
  identical: "Identisch",
};

const ORACLE_TYPES: SelectableType[] = [
  "table",
  "constraint",
  "index",
  "trigger",
  "view",
  "materialized_view",
  "sequence",
  "type",
  "type_body",
  "function",
  "procedure",
  "package",
  "package_body",
  "synonym",
  "comment",
  "grant",
];

const POSTGRES_TYPES: SelectableType[] = [
  "table",
  "constraint",
  "index",
  "trigger",
  "view",
  "materialized_view",
  "sequence",
  "type",
  "function",
  "procedure",
  "comment",
  "grant",
];

const SQL_SERVER_TYPES: SelectableType[] = [
  "table",
  "constraint",
  "index",
  "trigger",
  "view",
  "function",
  "procedure",
];

const SQLITE_TYPES: SelectableType[] = ["table", "constraint", "index", "trigger", "view"];

export function compareTypesFor(kind: DatabaseKind | null | undefined): SelectableType[] {
  if (kind === "oracle") return ORACLE_TYPES;
  if (kind === "postgres") return POSTGRES_TYPES;
  if (kind === "mysql" || kind === "mssql") return SQL_SERVER_TYPES;
  if (kind === "sqlite") return SQLITE_TYPES;
  return [];
}

export function defaultCompareTypes(kind: DatabaseKind | null | undefined): SelectableType[] {
  return compareTypesFor(kind).filter((type) => type !== "grant");
}
