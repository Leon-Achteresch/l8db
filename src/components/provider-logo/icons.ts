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

export function thesvgSvgForSlug(slug: string | null | undefined): string | null {
  if (!slug) return null;
  return ICONS[slug]?.svg ?? null;
}
