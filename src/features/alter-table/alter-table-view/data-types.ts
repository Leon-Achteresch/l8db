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
      "numeric(10, 2)",
      "real",
      "double precision",
      "smallserial",
      "serial",
      "bigserial",
    ],
  },
  {
    label: "Text",
    types: ["character varying", "varchar(255)", "character", "char(1)", "text", "citext"],
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

const MYSQL_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: ["tinyint", "smallint", "int", "bigint", "decimal(10, 2)", "float", "double"],
  },
  {
    label: "Text",
    types: ["varchar(255)", "char(1)", "text", "mediumtext", "longtext", "enum('a', 'b')"],
  },
  { label: "Datum / Zeit", types: ["date", "datetime", "timestamp", "time", "year"] },
  { label: "Boolean", types: ["boolean"] },
  { label: "Binär", types: ["varbinary(255)", "blob", "longblob"] },
  { label: "JSON", types: ["json"] },
];

const MSSQL_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: ["tinyint", "smallint", "int", "bigint", "decimal(18, 2)", "float", "real", "money"],
  },
  {
    label: "Text",
    types: ["nvarchar(255)", "nvarchar(max)", "varchar(255)", "varchar(max)", "nchar(1)"],
  },
  { label: "Datum / Zeit", types: ["date", "datetime2", "datetimeoffset", "time"] },
  { label: "Boolean", types: ["bit"] },
  { label: "Binär", types: ["varbinary(max)"] },
  { label: "UUID", types: ["uniqueidentifier"] },
  { label: "Sonstige", types: ["xml"] },
];

const ORACLE_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: ["NUMBER", "NUMBER(10)", "NUMBER(10, 2)", "BINARY_FLOAT", "BINARY_DOUBLE"],
  },
  { label: "Text", types: ["VARCHAR2(255)", "NVARCHAR2(255)", "CHAR(1)", "CLOB", "NCLOB"] },
  {
    label: "Datum / Zeit",
    types: ["DATE", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "INTERVAL DAY TO SECOND"],
  },
  { label: "Binär", types: ["RAW(16)", "BLOB"] },
];

const SQLITE_TYPES: DataTypeGroup[] = [
  { label: "Speicherklassen", types: ["INTEGER", "REAL", "TEXT", "BLOB", "NUMERIC"] },
];

const DUCKDB_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: [
      "TINYINT",
      "SMALLINT",
      "INTEGER",
      "BIGINT",
      "HUGEINT",
      "DECIMAL(18, 3)",
      "FLOAT",
      "DOUBLE",
    ],
  },
  { label: "Text", types: ["VARCHAR"] },
  { label: "Datum / Zeit", types: ["DATE", "TIME", "TIMESTAMP", "TIMESTAMPTZ", "INTERVAL"] },
  { label: "Boolean", types: ["BOOLEAN"] },
  { label: "Binär", types: ["BLOB"] },
  { label: "UUID", types: ["UUID"] },
  { label: "JSON", types: ["JSON"] },
  { label: "Verschachtelt", types: ["VARCHAR[]", "INTEGER[]", "MAP(VARCHAR, VARCHAR)"] },
];

const CASSANDRA_TYPES: DataTypeGroup[] = [
  {
    label: "Numerisch",
    types: ["tinyint", "smallint", "int", "bigint", "varint", "decimal", "float", "double"],
  },
  { label: "Text", types: ["text", "ascii"] },
  { label: "Datum / Zeit", types: ["timestamp", "date", "time", "duration"] },
  { label: "Boolean", types: ["boolean"] },
  { label: "Binär", types: ["blob"] },
  { label: "UUID", types: ["uuid", "timeuuid"] },
  { label: "Sammlungen", types: ["list<text>", "set<text>", "map<text, text>"] },
  { label: "Sonstige", types: ["inet"] },
];

const GENERIC_TYPES: DataTypeGroup[] = [
  { label: "Numerisch", types: ["integer", "bigint", "numeric(10, 2)", "double precision"] },
  { label: "Text", types: ["varchar(255)", "char(1)"] },
  { label: "Datum / Zeit", types: ["date", "timestamp"] },
  { label: "Boolean", types: ["boolean"] },
];

const TYPES_BY_KIND: Partial<Record<DatabaseKind, DataTypeGroup[]>> = {
  postgres: POSTGRES_TYPES,
  clickhouse: CLICKHOUSE_TYPES,
  mysql: MYSQL_TYPES,
  mssql: MSSQL_TYPES,
  oracle: ORACLE_TYPES,
  sqlite: SQLITE_TYPES,
  sqlite_http: SQLITE_TYPES,
  duckdb: DUCKDB_TYPES,
  cassandra: CASSANDRA_TYPES,
};

const DEFAULT_TYPE: Partial<Record<DatabaseKind, string>> = {
  postgres: "text",
  clickhouse: "String",
  mysql: "varchar(255)",
  mssql: "nvarchar(255)",
  oracle: "VARCHAR2(255)",
  sqlite: "TEXT",
  sqlite_http: "TEXT",
  duckdb: "VARCHAR",
  cassandra: "text",
};

export function defaultDataType(kind: DatabaseKind | undefined): string {
  return (kind && DEFAULT_TYPE[kind]) ?? "varchar(255)";
}

export function getDataTypeGroups(kind: DatabaseKind): DataTypeGroup[] {
  return TYPES_BY_KIND[kind] ?? GENERIC_TYPES;
}

export function isListedDataType(groups: DataTypeGroup[], value: string): boolean {
  const needle = value.trim().toLowerCase();
  return groups.some((g) => g.types.some((t) => t.toLowerCase() === needle));
}
