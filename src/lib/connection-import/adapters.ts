import type { DatabaseKind, SslMode } from "@/lib/db";

export type TlsWriter = "sslmode" | "secure" | "ssl" | "mongo" | "scheme" | "none";

export interface AdapterFacts {
  scheme: string;
  tlsScheme: string;
  fieldPort: number | null;
  fieldTlsPort: number | null;
  httpsUrlPort: number | null;
  tlsWriter: TlsWriter;
  insecureParam: [string, string] | null;
  flagMode: SslMode;
  flagKeys: string[];
  source: string;
}

export const ADAPTERS: Partial<Record<DatabaseKind, AdapterFacts>> = {
  postgres: {
    scheme: "postgresql",
    tlsScheme: "postgresql",
    fieldPort: 5432,
    fieldTlsPort: 5432,
    httpsUrlPort: null,
    tlsWriter: "sslmode",
    insecureParam: null,
    flagMode: "verify-full",
    flagKeys: ["ssl"],
    source: "connection.rs parse_pg_url",
  },
  mysql: {
    scheme: "mysql",
    tlsScheme: "mysql",
    fieldPort: 3306,
    fieldTlsPort: 3306,
    httpsUrlPort: null,
    tlsWriter: "sslmode",
    insecureParam: null,
    flagMode: "require",
    flagKeys: ["usessl", "requiressl", "ssl"],
    source: "mysql.rs parse_mysql_url",
  },
  mssql: {
    scheme: "mssql",
    tlsScheme: "mssql",
    fieldPort: 1433,
    fieldTlsPort: 1433,
    httpsUrlPort: null,
    tlsWriter: "sslmode",
    insecureParam: null,
    flagMode: "verify-full",
    flagKeys: ["encrypt"],
    source: "mssql.rs parse_mssql_url",
  },
  cassandra: {
    scheme: "cassandra",
    tlsScheme: "cassandra",
    fieldPort: 9042,
    fieldTlsPort: 9042,
    httpsUrlPort: null,
    tlsWriter: "sslmode",
    insecureParam: null,
    flagMode: "require",
    flagKeys: ["ssl", "tls"],
    source: "cassandra.rs parse_cassandra_url",
  },
  clickhouse: {
    scheme: "clickhouse",
    tlsScheme: "clickhouse",
    fieldPort: 8123,
    fieldTlsPort: 8443,
    httpsUrlPort: 8443,
    tlsWriter: "secure",
    insecureParam: null,
    flagMode: "verify-full",
    flagKeys: ["secure", "ssl"],
    source: "clickhouse.rs ClickhouseAdapter::new",
  },
  elasticsearch: {
    scheme: "elasticsearch",
    tlsScheme: "elasticsearch",
    fieldPort: 9200,
    fieldTlsPort: 9200,
    httpsUrlPort: null,
    tlsWriter: "ssl",
    insecureParam: ["insecure", "true"],
    flagMode: "verify-full",
    flagKeys: ["tls", "ssl", "secure"],
    source: "http_api.rs tls",
  },
  influxdb: {
    scheme: "influxdb",
    tlsScheme: "influxdb",
    fieldPort: 8086,
    fieldTlsPort: 8086,
    httpsUrlPort: null,
    tlsWriter: "ssl",
    insecureParam: ["insecure", "true"],
    flagMode: "verify-full",
    flagKeys: ["tls", "ssl", "secure"],
    source: "http_api.rs tls",
  },
  mongodb: {
    scheme: "mongodb",
    tlsScheme: "mongodb",
    fieldPort: 27017,
    fieldTlsPort: 27017,
    httpsUrlPort: null,
    tlsWriter: "mongo",
    insecureParam: ["tlsAllowInvalidCertificates", "true"],
    flagMode: "verify-full",
    flagKeys: ["tls", "ssl"],
    source: "mongodb.rs endpoint (driver ConnectionString)",
  },
  redis: {
    scheme: "redis",
    tlsScheme: "rediss",
    fieldPort: 6379,
    fieldTlsPort: 6379,
    httpsUrlPort: null,
    tlsWriter: "scheme",
    insecureParam: null,
    flagMode: "verify-full",
    flagKeys: ["ssl", "tls"],
    source: "redis.rs normalize_redis_url",
  },
  oracle: {
    scheme: "oracle",
    tlsScheme: "oracle",
    fieldPort: 1521,
    fieldTlsPort: 1521,
    httpsUrlPort: null,
    tlsWriter: "none",
    insecureParam: null,
    flagMode: "verify-full",
    flagKeys: [],
    source: "oracle.rs parse_oracle_url",
  },
};
