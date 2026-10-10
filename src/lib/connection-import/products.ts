import type { DatabaseKind } from "@/lib/db";

export interface ProductMatch {
  kind: DatabaseKind;
  label: string;
}

interface ProductRule extends ProductMatch {
  pattern: RegExp;
}

const UNSUPPORTED =
  /(^|[^a-z0-9])(db2|h2|derby|hsql(db)?|sybase|ase|informix|teradata|exasol|vertica|firebird|interbase|access|ucanaccess|sap|hana|maxdb|ingres|netezza|kingbase\d*|dameng|dm\d*|gaussdb|opengauss|neo4j|couchbase|couchdb|csv|jdbcx|odbc|trino|presto|hive|spark|impala|drill|phoenix|kylin|cosmos|databricks|ignite|nuodb|virtuoso|solr|kafka|ldap|excel|xml|json|wmi|mock)([^a-z]|$)/;

const RULES: ProductRule[] = [
  { pattern: /snowflake/, kind: "snowflake", label: "Snowflake" },
  { pattern: /bigquery/, kind: "bigquery", label: "Google BigQuery" },
  { pattern: /athena/, kind: "athena", label: "Amazon Athena" },
  { pattern: /dynamo/, kind: "dynamodb", label: "Amazon DynamoDB" },
  { pattern: /opensearch/, kind: "elasticsearch", label: "OpenSearch" },
  { pattern: /elastic|(^|[^a-z])es([^a-z]|$)/, kind: "elasticsearch", label: "Elasticsearch" },
  { pattern: /influx/, kind: "influxdb", label: "InfluxDB" },
  { pattern: /redshift/, kind: "postgres", label: "Amazon Redshift" },
  { pattern: /cockroach/, kind: "postgres", label: "CockroachDB" },
  { pattern: /greenplum/, kind: "postgres", label: "Greenplum" },
  { pattern: /timescale/, kind: "postgres", label: "TimescaleDB" },
  { pattern: /yugabyte/, kind: "postgres", label: "YugabyteDB" },
  { pattern: /materialize/, kind: "postgres", label: "Materialize" },
  { pattern: /questdb/, kind: "postgres", label: "QuestDB" },
  { pattern: /cratedb|(^|[^a-z])crate([^a-z]|$)/, kind: "postgres", label: "CrateDB" },
  { pattern: /alloydb/, kind: "postgres", label: "AlloyDB" },
  { pattern: /postgres|pgjdbc|(^|[^a-z])pg([^a-z]|$)/, kind: "postgres", label: "PostgreSQL" },
  { pattern: /mariadb/, kind: "mysql", label: "MariaDB" },
  { pattern: /tidb/, kind: "mysql", label: "TiDB" },
  { pattern: /singlestore|memsql/, kind: "mysql", label: "SingleStore" },
  { pattern: /planetscale/, kind: "mysql", label: "PlanetScale" },
  { pattern: /oceanbase/, kind: "mysql", label: "OceanBase" },
  { pattern: /starrocks|doris/, kind: "mysql", label: "Apache Doris" },
  { pattern: /mysql|aurora/, kind: "mysql", label: "MySQL" },
  {
    pattern: /sqlserver|sql server|mssql|jtds|microsoft|azure ?sql|azuresql/,
    kind: "mssql",
    label: "SQL Server",
  },
  { pattern: /oracle|(^|[^a-z])ora([^a-z]|$)/, kind: "oracle", label: "Oracle" },
  { pattern: /clickhouse|(^|[^a-z])ch([^a-z]|$)/, kind: "clickhouse", label: "ClickHouse" },
  { pattern: /duckdb/, kind: "duckdb", label: "DuckDB" },
  { pattern: /sqlite|libsql/, kind: "sqlite", label: "SQLite" },
  { pattern: /mongo|documentdb|ferretdb/, kind: "mongodb", label: "MongoDB" },
  { pattern: /redis|valkey|keydb|dragonfly/, kind: "redis", label: "Redis" },
  { pattern: /cassandra|scylla/, kind: "cassandra", label: "Apache Cassandra" },
];

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function isUnsupportedProduct(hint: string): boolean {
  const value = normalize(hint);
  return Boolean(value) && UNSUPPORTED.test(value);
}

export function matchProduct(hint: string): ProductMatch | null {
  const value = normalize(hint);
  if (!value || UNSUPPORTED.test(value)) return null;
  const rule = RULES.find((entry) => entry.pattern.test(value));
  return rule ? { kind: rule.kind, label: rule.label } : null;
}

export function resolveProduct(hints: string[]): ProductMatch | null {
  for (const hint of hints) {
    if (!normalize(hint)) continue;
    if (isUnsupportedProduct(hint)) return null;
    const match = matchProduct(hint);
    if (match) return match;
  }
  return null;
}

export const DEFAULT_PORTS: Partial<Record<DatabaseKind, number>> = {
  postgres: 5432,
  mysql: 3306,
  mssql: 1433,
  oracle: 1521,
  clickhouse: 8123,
  mongodb: 27017,
  redis: 6379,
  cassandra: 9042,
  elasticsearch: 9200,
  influxdb: 8086,
};

export const CLOUD_KINDS: DatabaseKind[] = ["snowflake", "bigquery", "athena", "dynamodb"];

export const FILE_KINDS: DatabaseKind[] = ["sqlite", "duckdb"];

export const PASSWORDLESS_KINDS: DatabaseKind[] = ["sqlite", "duckdb"];
