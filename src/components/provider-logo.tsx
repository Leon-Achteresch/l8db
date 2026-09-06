import { Database } from "lucide-react";
import apacheCassandra from "thesvg/apache-cassandra";
import apacheDoris from "thesvg/apache-doris";
import apacheHive from "thesvg/apache-hive";
import athena from "thesvg/aws-amazon-athena";
import documentdb from "thesvg/aws-amazon-documentdb";
import redshift from "thesvg/aws-amazon-redshift";
import cosmosdb from "thesvg/azure-azure-cosmos-db";
import clickhouse from "thesvg/clickhouse";
import cockroach from "thesvg/cockroach-labs";
import cratedb from "thesvg/cratedb";
import databricks from "thesvg/databricks";
import duckdb from "thesvg/duckdb";
import ferretdb from "thesvg/ferretdb";
import firebird from "thesvg/firebird";
import bigquery from "thesvg/google-bigquery";
import ibm from "thesvg/ibm";
import mariadb from "thesvg/mariadb";
import access from "thesvg/microsoft-access";
import mssql from "thesvg/microsoft-sql-server";
import mongodb from "thesvg/mongodb";
import mysql from "thesvg/mysql";
import neon from "thesvg/neon";
import oracle from "thesvg/oracle";
import planetscale from "thesvg/planetscale";
import postgresql from "thesvg/postgresql";
import redis from "thesvg/redis";
import sap from "thesvg/sap";
import scylladb from "thesvg/scylladb";
import singlestore from "thesvg/singlestore";
import snowflake from "thesvg/snowflake";
import sqlite from "thesvg/sqlite";
import supabase from "thesvg/supabase";
import teradata from "thesvg/teradata";
import tidb from "thesvg/tidb";
import timescale from "thesvg/timescale";
import trino from "thesvg/trino";
import turso from "thesvg/turso";
import valkey from "thesvg/valkey";
import vitess from "thesvg/vitess";
import yugabyte from "thesvg/yugabytedb";
import type { DatabaseKind } from "@/lib/db";
import { cn } from "@/lib/utils";

type IconModule = { svg: string };

const ICONS: Record<string, IconModule> = {
  "apache-cassandra": apacheCassandra,
  "apache-doris": apacheDoris,
  "apache-hive": apacheHive,
  "aws-amazon-athena": athena,
  "aws-amazon-documentdb": documentdb,
  "aws-amazon-redshift": redshift,
  "azure-azure-cosmos-db": cosmosdb,
  clickhouse,
  "cockroach-labs": cockroach,
  cratedb,
  databricks,
  duckdb,
  ferretdb,
  firebird,
  "google-bigquery": bigquery,
  ibm,
  mariadb,
  "microsoft-access": access,
  "microsoft-sql-server": mssql,
  mongodb,
  mysql,
  neon,
  oracle,
  planetscale,
  postgresql,
  redis,
  sap,
  scylladb,
  singlestore,
  snowflake,
  sqlite,
  supabase,
  teradata,
  tidb,
  timescale,
  trino,
  turso,
  valkey,
  vitess,
  yugabytedb: yugabyte,
};

const PROVIDER_SLUG: Record<string, string | null> = {
  postgres: "postgresql",
  supabase: "supabase",
  neon: "neon",
  cockroachdb: "cockroach-labs",
  redshift: "aws-amazon-redshift",
  timescale: "timescale",
  yugabyte: "yugabytedb",
  alloydb: "postgresql",
  materialize: "postgresql",
  cratedb: "cratedb",
  questdb: "postgresql",
  greenplum: "postgresql",
  "cloud-postgres": "postgresql",
  mysql: "mysql",
  mariadb: "mariadb",
  tidb: "tidb",
  planetscale: "planetscale",
  singlestore: "singlestore",
  "aurora-mysql": "mysql",
  vitess: "vitess",
  doris: "apache-doris",
  oceanbase: "mysql",
  sqlite: "sqlite",
  libsql: "turso",
  duckdb: "duckdb",
  mssql: "microsoft-sql-server",
  "azure-sql": "microsoft-sql-server",
  clickhouse: "clickhouse",
  mongodb: "mongodb",
  atlas: "mongodb",
  documentdb: "aws-amazon-documentdb",
  "cosmosdb-mongo": "azure-azure-cosmos-db",
  ferretdb: "ferretdb",
  redis: "redis",
  valkey: "valkey",
  keydb: "redis",
  dragonfly: "redis",
  oracle: "oracle",
  cassandra: "apache-cassandra",
  scylladb: "scylladb",
  odbc: null,
  db2: "ibm",
  firebird: "firebird",
  informix: "ibm",
  sybase: "sap",
  hana: "sap",
  teradata: "teradata",
  snowflake: "snowflake",
  bigquery: "google-bigquery",
  databricks: "databricks",
  athena: "aws-amazon-athena",
  vertica: null,
  exasol: null,
  trino: "trino",
  hive: "apache-hive",
  netezza: "ibm",
  access: "microsoft-access",
};

const KIND_SLUG: Record<DatabaseKind, string | null> = {
  postgres: "postgresql",
  mysql: "mysql",
  sqlite: "sqlite",
  mssql: "microsoft-sql-server",
  clickhouse: "clickhouse",
  mongodb: "mongodb",
  redis: "redis",
  oracle: "oracle",
  cassandra: "apache-cassandra",
  duckdb: "duckdb",
  odbc: null,
};

interface ProviderLogoProps {
  providerId?: string | null;
  kind?: DatabaseKind | null;
  className?: string;
}

export function ProviderLogo({ providerId, kind, className }: ProviderLogoProps) {
  const slug = (providerId ? PROVIDER_SLUG[providerId] : undefined) ?? (kind ? KIND_SLUG[kind] : null) ?? null;
  const icon = slug ? ICONS[slug] : undefined;
  if (!icon) return <Database className={cn("size-4 shrink-0", className)} aria-hidden />;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
