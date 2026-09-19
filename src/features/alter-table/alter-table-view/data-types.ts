import type { DatabaseKind } from "@/lib/db";

export interface DataTypeGroup {
  label: string;
  types: string[];
}

export const POSTGRES_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: [
      "smallint",
      "integer",
      "bigint",
      "decimal",
      "numeric",
      "real",
      "double precision",
      "smallserial",
      "serial",
      "bigserial",
    ],
  },
  {
    label: "Text",
    types: ["character varying", "varchar", "character", "char", "text", "citext"],
  },
  {
    label: "Datum / Zeit",
    types: [
      "timestamp without time zone",
      "timestamp with time zone",
      "date",
      "time without time zone",
      "time with time zone",
      "interval",
    ],
  },
  {
    label: "Boolean",
    types: ["boolean"],
  },
  {
    label: "Binär",
    types: ["bytea"],
  },
  {
    label: "UUID",
    types: ["uuid"],
  },
  {
    label: "JSON",
    types: ["json", "jsonb"],
  },
  {
    label: "Netzwerk",
    types: ["inet", "cidr", "macaddr", "macaddr8"],
  },
  {
    label: "Geometrie",
    types: ["point", "line", "lseg", "box", "path", "polygon", "circle"],
  },
  {
    label: "Array",
    types: ["integer[]", "text[]", "boolean[]", "varchar[]", "bigint[]", "uuid[]", "jsonb[]"],
  },
  {
    label: "Bereich",
    types: ["int4range", "int8range", "numrange", "tsrange", "tstzrange", "daterange"],
  },
  {
    label: "Sonstige",
    types: [
      "money",
      "bit",
      "bit varying",
      "tsvector",
      "tsquery",
      "xml",
      "oid",
      "pg_lsn",
      "pg_snapshot",
    ],
  },
];

export const CLICKHOUSE_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: [
      "UInt8",
      "UInt32",
      "UInt64",
      "Int8",
      "Int32",
      "Int64",
      "Float32",
      "Float64",
      "Decimal(18, 4)",
    ],
  },
  { label: "Text", types: ["String", "FixedString(16)", "LowCardinality(String)", "UUID"] },
  { label: "Datum / Zeit", types: ["Date", "Date32", "DateTime", "DateTime64(3)"] },
  { label: "Boolean", types: ["Bool"] },
  { label: "JSON", types: ["JSON"] },
  {
    label: "Sonstige",
    types: [
      "Array(String)",
      "Array(UInt64)",
      "Map(String, String)",
      "Nullable(String)",
      "IPv4",
      "IPv6",
    ],
  },
];

export function defaultDataType(kind: DatabaseKind | undefined): string {
  return kind === "clickhouse" ? "String" : "text";
}

export function getDataTypeGroups(kind: DatabaseKind): DataTypeGroup[] {
  return kind === "clickhouse" ? CLICKHOUSE_TYPES : POSTGRES_TYPES;
}
