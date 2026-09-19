import type { DatabaseKind } from "@/lib/db";

export const SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"];

export const PATH_LIKE = /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|:memory:$)/;

export const USER_REQUIRED: DatabaseKind[] = ["postgres", "mysql", "mssql", "oracle"];

export const DATABASE_REQUIRED: DatabaseKind[] = ["postgres", "oracle"];

export const SSLMODE_PARAM: DatabaseKind[] = ["postgres", "mysql", "mssql"];

export const ORACLE_USER_KEYS = ["userid", "uid", "username", "user"];

export const ORACLE_PASSWORD_KEYS = ["password", "pwd"];

export const ORACLE_SOURCE_KEYS = ["datasource"];

export const NON_ORACLE_KEYS = [
  "initialcatalog",
  "database",
  "integratedsecurity",
  "trustedconnection",
  "trustservercertificate",
  "encrypt",
  "server",
];
