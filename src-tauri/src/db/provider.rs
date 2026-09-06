use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseKind {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Clickhouse,
    Mongodb,
    Redis,
    Oracle,
    Cassandra,
    Duckdb,
    Odbc,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct Capabilities {
    pub databases: bool,
    pub schemas: bool,
    pub views: bool,
    pub view_editor: bool,
    pub materialized_views: bool,
    pub functions: bool,
    pub extensions: bool,
    pub roles: bool,
    pub privileges: bool,
    pub sequences: bool,
    pub enums: bool,
    pub triggers: bool,
    pub indexes: bool,
    pub constraints: bool,
    pub foreign_keys: bool,
    pub rls: bool,
    pub partitions: bool,
    pub replication: bool,
    pub sessions: bool,
    pub locks: bool,
    pub transactions: bool,
    pub row_edit: bool,
    pub ddl: bool,
    pub alter_columns: bool,
    pub explain: bool,
    pub overview: bool,
    pub sql_filter: bool,
    pub read_only_mode: bool,
    pub csv_import: bool,
    pub column_search: bool,
    pub source_search: bool,
    pub schema_snapshot: bool,
    pub full_table_export: bool,
    pub data_compare: bool,
    pub procedures: bool,
    pub compile_objects: bool,
    pub debugger: bool,
    pub bind_parameters: bool,
    pub ssl: bool,
    pub ssh: bool,
    pub query_language: &'static str,
    pub filter_hint: &'static str,
}

const NONE: Capabilities = Capabilities {
    databases: true,
    schemas: true,
    views: false,
    view_editor: false,
    materialized_views: false,
    functions: false,
    extensions: false,
    roles: false,
    privileges: false,
    sequences: false,
    enums: false,
    triggers: false,
    indexes: false,
    constraints: false,
    foreign_keys: false,
    rls: false,
    partitions: false,
    replication: false,
    sessions: false,
    locks: false,
    transactions: false,
    row_edit: false,
    ddl: false,
    alter_columns: false,
    explain: false,
    overview: false,
    sql_filter: true,
    read_only_mode: false,
    csv_import: false,
    column_search: false,
    source_search: false,
    schema_snapshot: false,
    full_table_export: false,
    data_compare: false,
    procedures: false,
    compile_objects: false,
    debugger: false,
    bind_parameters: false,
    ssl: true,
    ssh: true,
    query_language: "sql",
    filter_hint: "SQL WHERE-Ausdruck",
};

const SQL_COMMON: Capabilities = Capabilities {
    views: true,
    view_editor: true,
    functions: true,
    triggers: true,
    indexes: true,
    constraints: true,
    foreign_keys: true,
    ddl: true,
    alter_columns: true,
    explain: true,
    overview: true,
    ..NONE
};

impl DatabaseKind {
    #[cfg(test)]
    pub const ALL: [DatabaseKind; 11] = [
        DatabaseKind::Postgres,
        DatabaseKind::Mysql,
        DatabaseKind::Sqlite,
        DatabaseKind::Mssql,
        DatabaseKind::Clickhouse,
        DatabaseKind::Mongodb,
        DatabaseKind::Redis,
        DatabaseKind::Oracle,
        DatabaseKind::Cassandra,
        DatabaseKind::Duckdb,
        DatabaseKind::Odbc,
    ];

    pub fn capabilities(self) -> Capabilities {
        match self {
            DatabaseKind::Postgres => Capabilities {
                bind_parameters: true,
                read_only_mode: true,
                csv_import: true,
                column_search: true,
                source_search: true,
                schema_snapshot: true,
                full_table_export: true,
                data_compare: true,
                procedures: true,
                compile_objects: true,
                materialized_views: true,
                extensions: true,
                roles: true,
                privileges: true,
                sequences: true,
                enums: true,
                rls: true,
                partitions: true,
                replication: true,
                sessions: true,
                locks: true,
                transactions: true,
                row_edit: true,
                ..SQL_COMMON
            },
            DatabaseKind::Mysql => Capabilities {
                sessions: true,
                transactions: true,
                row_edit: true,
                ..SQL_COMMON
            },
            DatabaseKind::Sqlite => Capabilities {
                databases: false,
                ssl: false,
                ssh: false,
                functions: false,
                transactions: true,
                row_edit: true,
                ..SQL_COMMON
            },
            DatabaseKind::Duckdb => Capabilities {
                databases: false,
                ssl: false,
                ssh: false,
                functions: false,
                ..SQL_COMMON
            },
            DatabaseKind::Mssql => Capabilities {
                sessions: true,
                sequences: true,
                transactions: true,
                row_edit: true,
                ..SQL_COMMON
            },
            DatabaseKind::Clickhouse => Capabilities {
                ssl: false,
                views: true,
                view_editor: true,
                functions: true,
                ddl: true,
                alter_columns: true,
                explain: true,
                overview: true,
                ..NONE
            },
            DatabaseKind::Oracle => Capabilities {
                databases: false,
                ssl: false,
                procedures: true,
                compile_objects: true,
                debugger: true,
                sequences: true,
                sessions: true,
                transactions: true,
                row_edit: true,
                ..SQL_COMMON
            },
            DatabaseKind::Cassandra => Capabilities {
                ssl: false,
                indexes: true,
                ddl: true,
                alter_columns: true,
                query_language: "cql",
                filter_hint: "CQL WHERE-Ausdruck (Partition Key, ALLOW FILTERING wird ergänzt)",
                ..NONE
            },
            DatabaseKind::Mongodb => Capabilities {
                ssl: false,
                indexes: true,
                ddl: true,
                query_language: "json",
                filter_hint: "MongoDB-Filter als JSON, z. B. {\"status\": \"active\"}",
                ..NONE
            },
            DatabaseKind::Redis => Capabilities {
                schemas: false,
                ssl: false,
                query_language: "redis",
                filter_hint: "Key-Pattern, z. B. user:*",
                ..NONE
            },
            DatabaseKind::Odbc => Capabilities {
                databases: false,
                views: true,
                ddl: true,
                ssl: false,
                ..NONE
            },
        }
    }

    pub fn url_schemes(self) -> &'static [&'static str] {
        match self {
            DatabaseKind::Postgres => &["postgresql", "postgres"],
            DatabaseKind::Mysql => &["mysql", "mariadb"],
            DatabaseKind::Sqlite => &["sqlite", "file"],
            DatabaseKind::Mssql => &["mssql", "sqlserver"],
            DatabaseKind::Clickhouse => &["clickhouse", "http", "https"],
            DatabaseKind::Mongodb => &["mongodb", "mongodb+srv"],
            DatabaseKind::Redis => &["redis", "rediss", "valkey"],
            DatabaseKind::Oracle => &["oracle"],
            DatabaseKind::Cassandra => &["cassandra", "scylla"],
            DatabaseKind::Duckdb => &["duckdb"],
            DatabaseKind::Odbc => &["odbc"],
        }
    }

    pub fn is_file_based(self) -> bool {
        matches!(self, DatabaseKind::Sqlite | DatabaseKind::Duckdb)
    }
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case", tag = "type")]
pub enum Driver {
    Builtin,
    RuntimeLibrary { library: &'static str },
    Odbc { driver: &'static str },
    CargoFeature { feature: &'static str },
}

#[derive(Debug, Clone, Serialize)]
pub struct InstallHint {
    pub os: &'static str,
    pub command: &'static str,
    pub url: &'static str,
}

#[derive(Debug, Clone, Serialize)]
pub struct DriverStatus {
    pub available: bool,
    pub detail: String,
    pub install: Vec<InstallHint>,
    pub install_command: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderInfo {
    pub id: &'static str,
    pub name: &'static str,
    pub group: &'static str,
    pub kind: DatabaseKind,
    pub default_port: Option<u16>,
    pub file_based: bool,
    pub url_schemes: &'static [&'static str],
    pub placeholder: &'static str,
    pub hint: &'static str,
    pub hosts: &'static [&'static str],
    pub driver: Driver,
    pub capabilities: Capabilities,
    pub driver_status: DriverStatus,
}

struct Provider {
    id: &'static str,
    name: &'static str,
    group: &'static str,
    kind: DatabaseKind,
    port: Option<u16>,
    placeholder: &'static str,
    hint: &'static str,
    hosts: &'static [&'static str],
    driver: Driver,
}

const fn pg(
    id: &'static str,
    name: &'static str,
    port: u16,
    placeholder: &'static str,
    hint: &'static str,
    hosts: &'static [&'static str],
) -> Provider {
    Provider {
        id,
        name,
        group: "PostgreSQL-kompatibel",
        kind: DatabaseKind::Postgres,
        port: Some(port),
        placeholder,
        hint,
        hosts,
        driver: Driver::Builtin,
    }
}

const fn my(
    id: &'static str,
    name: &'static str,
    port: u16,
    placeholder: &'static str,
    hint: &'static str,
    hosts: &'static [&'static str],
) -> Provider {
    Provider {
        id,
        name,
        group: "MySQL-kompatibel",
        kind: DatabaseKind::Mysql,
        port: Some(port),
        placeholder,
        hint,
        hosts,
        driver: Driver::Builtin,
    }
}

const fn odbc(
    id: &'static str,
    name: &'static str,
    port: Option<u16>,
    driver: &'static str,
    placeholder: &'static str,
    hint: &'static str,
) -> Provider {
    Provider {
        id,
        name,
        group: "ODBC",
        kind: DatabaseKind::Odbc,
        port,
        placeholder,
        hint,
        hosts: &[],
        driver: Driver::Odbc { driver },
    }
}

const PROVIDERS: &[Provider] = &[
    pg("postgres", "PostgreSQL", 5432, "postgresql://postgres:password@localhost:5432/postgres", "Lokaler Server oder eigener Host. Alle Funktionen des SQL-Arbeitsplatzes verfügbar.", &["localhost", "127.0.0.1"]),
    pg("supabase", "Supabase", 5432, "postgresql://postgres:password@db.project.supabase.co:5432/postgres", "Direkte URL aus Connect. In IPv4-Netzen eignet sich der Session Pooler auf Port 5432.", &[".supabase.co", ".supabase.com"]),
    pg("neon", "Neon", 5432, "postgresql://user:password@ep-project.eu-central-1.aws.neon.tech/neondb?sslmode=require", "URL aus dem Connect-Dialog des Branches. SSL und URL-Parameter bleiben erhalten.", &[".neon.tech"]),
    pg("cockroachdb", "CockroachDB", 26257, "postgresql://root@localhost:26257/defaultdb?sslmode=disable", "PostgreSQL-Wire-Protokoll. Rollen, Extensions und Replikation weichen von PostgreSQL ab.", &[".cockroachlabs.cloud"]),
    pg("redshift", "Amazon Redshift", 5439, "postgresql://awsuser:password@cluster.region.redshift.amazonaws.com:5439/dev", "Redshift spricht PostgreSQL 8.x. Einige Katalogabfragen liefern reduzierte Daten.", &[".redshift.amazonaws.com"]),
    pg("timescale", "TimescaleDB", 5432, "postgresql://tsdbadmin:password@service.tsdb.cloud.timescale.com:5432/tsdb?sslmode=require", "Vollständig PostgreSQL-kompatibel inklusive Hypertables als normale Tabellen.", &[".timescale.com"]),
    pg("yugabyte", "YugabyteDB", 5433, "postgresql://yugabyte:yugabyte@localhost:5433/yugabyte", "YSQL-API über das PostgreSQL-Protokoll.", &[".yugabyte.cloud"]),
    pg("alloydb", "AlloyDB", 5432, "postgresql://postgres:password@10.0.0.2:5432/postgres", "Google AlloyDB über den Auth Proxy oder eine private IP.", &[]),
    pg("materialize", "Materialize", 6875, "postgresql://materialize@localhost:6875/materialize", "Streaming-SQL über das PostgreSQL-Protokoll.", &[".materialize.cloud"]),
    pg("cratedb", "CrateDB", 5432, "postgresql://crate@localhost:5432/doc", "PostgreSQL-Wire-Protokoll mit eigenem Katalog.", &[".cratedb.net"]),
    pg("questdb", "QuestDB", 8812, "postgresql://admin:quest@localhost:8812/qdb", "Zeitreihen-Datenbank über das PostgreSQL-Protokoll auf Port 8812.", &[]),
    pg("greenplum", "Greenplum", 5432, "postgresql://gpadmin:password@localhost:5432/gpadmin", "MPP-Datenbank auf PostgreSQL-Basis.", &[]),
    pg("cloud-postgres", "Cloud Postgres", 5432, "postgresql://user:password@db.example.com:5432/app?sslmode=require", "RDS, Railway, Render, Fly, Heroku und weitere Anbieter mit externem Endpunkt.", &[".rds.amazonaws.com", ".railway.app", ".render.com", ".fly.dev", ".herokuapp.com"]),
    my("mysql", "MySQL", 3306, "mysql://root:password@localhost:3306/mysql", "MySQL 5.7 und 8.x. Schemas entsprechen den Datenbanken.", &["localhost", "127.0.0.1"]),
    my("mariadb", "MariaDB", 3306, "mysql://root:password@localhost:3306/mysql", "MariaDB über das MySQL-Protokoll.", &[".mariadb.com"]),
    my("tidb", "TiDB", 4000, "mysql://root@localhost:4000/test", "TiDB Serverless und Self-Hosted über das MySQL-Protokoll.", &[".tidbcloud.com"]),
    my("planetscale", "PlanetScale", 3306, "mysql://user:password@aws.connect.psdb.cloud:3306/db?ssl-mode=required", "TLS ist Pflicht. Nutze die URL aus den Verbindungseinstellungen.", &[".psdb.cloud"]),
    my("singlestore", "SingleStore", 3306, "mysql://admin:password@svc.singlestore.com:3306/db", "SingleStore Helios und Self-Managed über das MySQL-Protokoll.", &[".singlestore.com"]),
    my("aurora-mysql", "Aurora MySQL", 3306, "mysql://admin:password@cluster.cluster-id.region.rds.amazonaws.com:3306/db", "Amazon Aurora mit MySQL-Kompatibilität.", &[]),
    my("vitess", "Vitess", 15306, "mysql://user@localhost:15306/keyspace", "Vitess VTGate über das MySQL-Protokoll.", &[]),
    my("doris", "Apache Doris", 9030, "mysql://root@localhost:9030/demo", "Doris und StarRocks über den MySQL-Port des Frontends.", &[]),
    my("oceanbase", "OceanBase", 2881, "mysql://root@localhost:2881/test", "OceanBase im MySQL-Modus.", &[]),
    Provider { id: "sqlite", name: "SQLite", group: "Dateibasiert", kind: DatabaseKind::Sqlite, port: None, placeholder: "/Users/name/daten/app.db", hint: "Pfad zu einer SQLite-Datei oder :memory:. Eingebetteter Treiber, keine Installation nötig.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "libsql", name: "libSQL / Turso (lokal)", group: "Dateibasiert", kind: DatabaseKind::Sqlite, port: None, placeholder: "/Users/name/daten/local.db", hint: "Lokale libSQL-Dateien sind SQLite-kompatibel.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "duckdb", name: "DuckDB", group: "Dateibasiert", kind: DatabaseKind::Duckdb, port: None, placeholder: "/Users/name/daten/analytics.duckdb", hint: "Analytische Datei-Datenbank. Benötigt einen Build mit dem Cargo-Feature duckdb.", hosts: &[], driver: Driver::CargoFeature { feature: "duckdb" } },
    Provider { id: "mssql", name: "SQL Server", group: "Microsoft", kind: DatabaseKind::Mssql, port: Some(1433), placeholder: "mssql://sa:Password1@localhost:1433/master?encrypt=false", hint: "TDS-Protokoll. Parameter: encrypt=true|false, trust_server_certificate=true.", hosts: &["localhost", "127.0.0.1"], driver: Driver::Builtin },
    Provider { id: "azure-sql", name: "Azure SQL", group: "Microsoft", kind: DatabaseKind::Mssql, port: Some(1433), placeholder: "mssql://user:password@server.database.windows.net:1433/db?encrypt=true", hint: "Azure erfordert Verschlüsselung. Login im Format user oder user@server.", hosts: &[".database.windows.net"], driver: Driver::Builtin },
    Provider { id: "clickhouse", name: "ClickHouse", group: "Analytisch", kind: DatabaseKind::Clickhouse, port: Some(8123), placeholder: "clickhouse://default:password@localhost:8123/default", hint: "HTTP-Schnittstelle auf Port 8123 (8443 mit ?secure=1).", hosts: &[".clickhouse.cloud"], driver: Driver::Builtin },
    Provider { id: "mongodb", name: "MongoDB", group: "NoSQL", kind: DatabaseKind::Mongodb, port: Some(27017), placeholder: "mongodb://user:password@localhost:27017/app?authSource=admin", hint: "Collections erscheinen als Tabellen. Filter und Queries sind JSON-Dokumente.", hosts: &["localhost", "127.0.0.1"], driver: Driver::Builtin },
    Provider { id: "atlas", name: "MongoDB Atlas", group: "NoSQL", kind: DatabaseKind::Mongodb, port: None, placeholder: "mongodb+srv://user:password@cluster0.abcde.mongodb.net/app", hint: "SRV-URL aus dem Atlas-Connect-Dialog.", hosts: &[".mongodb.net"], driver: Driver::Builtin },
    Provider { id: "documentdb", name: "Amazon DocumentDB", group: "NoSQL", kind: DatabaseKind::Mongodb, port: Some(27017), placeholder: "mongodb://user:password@cluster.region.docdb.amazonaws.com:27017/app?tls=true&retryWrites=false", hint: "MongoDB-API. retryWrites=false ist erforderlich.", hosts: &[".docdb.amazonaws.com"], driver: Driver::Builtin },
    Provider { id: "cosmosdb-mongo", name: "Azure Cosmos DB (Mongo)", group: "NoSQL", kind: DatabaseKind::Mongodb, port: Some(10255), placeholder: "mongodb://account:key@account.mongo.cosmos.azure.com:10255/?ssl=true", hint: "MongoDB-API von Cosmos DB.", hosts: &[".mongo.cosmos.azure.com"], driver: Driver::Builtin },
    Provider { id: "ferretdb", name: "FerretDB", group: "NoSQL", kind: DatabaseKind::Mongodb, port: Some(27017), placeholder: "mongodb://user:password@localhost:27017/app", hint: "MongoDB-kompatibles Frontend auf PostgreSQL.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "redis", name: "Redis", group: "Key-Value", kind: DatabaseKind::Redis, port: Some(6379), placeholder: "redis://default:password@localhost:6379/0", hint: "Keys erscheinen als Tabelle. Queries sind Redis-Befehle, z. B. HGETALL user:1.", hosts: &["localhost", "127.0.0.1"], driver: Driver::Builtin },
    Provider { id: "valkey", name: "Valkey", group: "Key-Value", kind: DatabaseKind::Redis, port: Some(6379), placeholder: "redis://localhost:6379/0", hint: "Redis-kompatibler Fork.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "keydb", name: "KeyDB", group: "Key-Value", kind: DatabaseKind::Redis, port: Some(6379), placeholder: "redis://localhost:6379/0", hint: "Redis-kompatibel.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "dragonfly", name: "Dragonfly", group: "Key-Value", kind: DatabaseKind::Redis, port: Some(6379), placeholder: "redis://localhost:6379/0", hint: "Redis-kompatibel.", hosts: &[], driver: Driver::Builtin },
    Provider { id: "oracle", name: "Oracle Database", group: "Enterprise", kind: DatabaseKind::Oracle, port: Some(1521), placeholder: "oracle://system:password@localhost:1521/FREEPDB1", hint: "Benötigt den Oracle Instant Client (wird zur Laufzeit geladen). Schemas entsprechen Benutzern.", hosts: &["localhost", "127.0.0.1"], driver: Driver::RuntimeLibrary { library: "Oracle Instant Client" } },
    Provider { id: "cassandra", name: "Apache Cassandra", group: "Wide-Column", kind: DatabaseKind::Cassandra, port: Some(9042), placeholder: "cassandra://cassandra:cassandra@localhost:9042/keyspace", hint: "CQL über das native Protokoll. Keyspaces erscheinen als Schemas.", hosts: &["localhost", "127.0.0.1"], driver: Driver::Builtin },
    Provider { id: "scylladb", name: "ScyllaDB", group: "Wide-Column", kind: DatabaseKind::Cassandra, port: Some(9042), placeholder: "cassandra://scylla:password@node.clusters.scylla.cloud:9042/keyspace", hint: "Cassandra-kompatibel.", hosts: &[".scylla.cloud"], driver: Driver::Builtin },
    odbc("odbc", "ODBC (generisch)", None, "", "odbc://?Driver=Name&Server=host&Database=db&UID=user&PWD=pass", "Beliebiger installierter ODBC-Treiber. Die Query-Parameter bilden den Connection String."),
    odbc("db2", "IBM Db2", Some(50000), "IBM DB2 ODBC DRIVER", "odbc://db2inst1:password@localhost:50000/SAMPLE?Driver=IBM%20DB2%20ODBC%20DRIVER", "Benötigt den IBM Data Server Driver (ODBC)."),
    odbc("firebird", "Firebird", Some(3050), "Firebird/InterBase(r) driver", "odbc://SYSDBA:masterkey@localhost:3050/%2Fdata%2Fdb.fdb?Driver=Firebird%2FInterBase(r)%20driver", "Benötigt den Firebird ODBC-Treiber."),
    odbc("informix", "IBM Informix", Some(9088), "IBM INFORMIX ODBC DRIVER", "odbc://informix:password@localhost:9088/stores?Driver=IBM%20INFORMIX%20ODBC%20DRIVER&Server=ol_informix", "Benötigt das Informix Client SDK."),
    odbc("sybase", "SAP ASE (Sybase)", Some(5000), "Adaptive Server Enterprise", "odbc://sa:password@localhost:5000/master?Driver=Adaptive%20Server%20Enterprise", "Benötigt den SAP ASE ODBC-Treiber."),
    odbc("hana", "SAP HANA", Some(30015), "HDBODBC", "odbc://SYSTEM:password@localhost:30015/?Driver=HDBODBC", "Benötigt den SAP HANA Client (HDBODBC)."),
    odbc("teradata", "Teradata", Some(1025), "Teradata Database ODBC Driver", "odbc://dbc:dbc@localhost:1025/?Driver=Teradata%20Database%20ODBC%20Driver", "Benötigt Teradata Tools and Utilities."),
    odbc("snowflake", "Snowflake", Some(443), "SnowflakeDSIIDriver", "odbc://user:password@account.snowflakecomputing.com:443/DB?Driver=SnowflakeDSIIDriver&Warehouse=WH&Schema=PUBLIC", "Benötigt den Snowflake ODBC-Treiber."),
    odbc("bigquery", "Google BigQuery", None, "Simba ODBC Driver for Google BigQuery", "odbc://?Driver=Simba%20ODBC%20Driver%20for%20Google%20BigQuery&Catalog=project&OAuthMechanism=0&KeyFilePath=%2Fpath%2Fkey.json&Email=sa%40project.iam.gserviceaccount.com", "Benötigt den Simba BigQuery ODBC-Treiber."),
    odbc("databricks", "Databricks", Some(443), "Simba Spark ODBC Driver", "odbc://token:dapi...@adb-123.azuredatabricks.net:443/?Driver=Simba%20Spark%20ODBC%20Driver&HTTPPath=%2Fsql%2F1.0%2Fwarehouses%2Fabc&SSL=1&ThriftTransport=2&AuthMech=3", "Benötigt den Databricks (Simba Spark) ODBC-Treiber."),
    odbc("athena", "Amazon Athena", Some(443), "Simba Athena ODBC Driver", "odbc://?Driver=Simba%20Athena%20ODBC%20Driver&AwsRegion=eu-central-1&S3OutputLocation=s3%3A%2F%2Fbucket%2F&AuthenticationType=IAM%20Credentials&UID=key&PWD=secret", "Benötigt den Athena ODBC-Treiber."),
    odbc("vertica", "Vertica", Some(5433), "Vertica", "odbc://dbadmin:password@localhost:5433/VMart?Driver=Vertica", "Benötigt den Vertica ODBC-Treiber."),
    odbc("exasol", "Exasol", Some(8563), "EXASOL Driver", "odbc://sys:exasol@localhost:8563/?Driver=EXASOL%20Driver&EXAHOST=localhost%3A8563", "Benötigt den Exasol ODBC-Treiber."),
    odbc("trino", "Trino / Presto", Some(8080), "Trino ODBC Driver", "odbc://user@localhost:8080/hive?Driver=Trino%20ODBC%20Driver", "Benötigt den Starburst/Trino ODBC-Treiber."),
    odbc("hive", "Apache Hive / Impala", Some(10000), "Cloudera ODBC Driver for Apache Hive", "odbc://hive@localhost:10000/default?Driver=Cloudera%20ODBC%20Driver%20for%20Apache%20Hive", "Benötigt den Cloudera Hive- oder Impala-ODBC-Treiber."),
    odbc("netezza", "IBM Netezza", Some(5480), "NetezzaSQL", "odbc://admin:password@localhost:5480/SYSTEM?Driver=NetezzaSQL", "Benötigt den Netezza ODBC-Treiber."),
    odbc("access", "Microsoft Access", None, "Microsoft Access Driver (*.mdb, *.accdb)", "odbc://?Driver=Microsoft%20Access%20Driver%20(*.mdb%2C%20*.accdb)&DBQ=C%3A%5Cdaten%5Capp.accdb", "Nur unter Windows mit der Access Database Engine."),
];

fn unixodbc_hints() -> Vec<InstallHint> {
    vec![
        InstallHint {
            os: "macos",
            command: "brew install unixodbc",
            url: "https://www.unixodbc.org",
        },
        InstallHint {
            os: "linux",
            command: "sudo apt install unixodbc unixodbc-dev",
            url: "https://www.unixodbc.org",
        },
        InstallHint {
            os: "windows",
            command: "ODBC-Datenquellen-Administrator ist Teil von Windows",
            url: "https://learn.microsoft.com/sql/odbc/admin/odbc-data-source-administrator",
        },
    ]
}

fn odbc_driver_hints(driver: &'static str) -> Vec<InstallHint> {
    let url = match driver {
        "IBM DB2 ODBC DRIVER" => "https://www.ibm.com/support/pages/db2-odbc-cli-driver-download-and-installation-information",
        "Firebird/InterBase(r) driver" => "https://firebirdsql.org/en/odbc-driver/",
        "IBM INFORMIX ODBC DRIVER" => "https://www.ibm.com/products/informix/client-sdk",
        "Adaptive Server Enterprise" => "https://help.sap.com/docs/SAP_ASE",
        "HDBODBC" => "https://tools.hana.ondemand.com/#hanatools",
        "Teradata Database ODBC Driver" => "https://downloads.teradata.com/download/connectivity/odbc-driver",
        "SnowflakeDSIIDriver" => "https://docs.snowflake.com/en/developer-guide/odbc/odbc-download",
        "Simba ODBC Driver for Google BigQuery" => "https://cloud.google.com/bigquery/docs/reference/odbc-jdbc-drivers",
        "Simba Spark ODBC Driver" => "https://www.databricks.com/spark/odbc-drivers-download",
        "Simba Athena ODBC Driver" => "https://docs.aws.amazon.com/athena/latest/ug/connect-with-odbc.html",
        "Vertica" => "https://www.vertica.com/download/vertica/client-drivers/",
        "EXASOL Driver" => "https://downloads.exasol.com/clients-and-drivers/odbc",
        "Trino ODBC Driver" => "https://docs.starburst.io/clients/odbc.html",
        "Cloudera ODBC Driver for Apache Hive" => "https://www.cloudera.com/downloads/connectors/hive/odbc.html",
        "NetezzaSQL" => "https://www.ibm.com/docs/en/netezza",
        "Microsoft Access Driver (*.mdb, *.accdb)" => "https://www.microsoft.com/download/details.aspx?id=54920",
        _ => "https://www.unixodbc.org",
    };
    let mut hints = unixodbc_hints();
    hints.push(InstallHint {
        os: "all",
        command: "Treiber des Herstellers installieren und in odbcinst.ini registrieren",
        url,
    });
    hints
}

const ORACLE_MACOS_INTEL_INSTALL: &str = "brew tap InstantClientTap/instantclient && brew trust instantclienttap/instantclient && brew install instantclient-basic";

const ORACLE_MACOS_ARM64_INSTALL: &str = "mkdir -p \"$HOME/lib\" /tmp/l8db-ic && curl -fL -H \"Cookie: oraclelicense=accept-securebackup-cookie\" -o /tmp/l8db-ic/ic.dmg \"https://download.oracle.com/otn_software/mac/instantclient/instantclient-basic-macos-arm64.dmg\" && hdiutil attach /tmp/l8db-ic/ic.dmg && sh /Volumes/instantclient-basic-macos.arm64-*/install_ic.sh && for f in $(ls -td \"$HOME\"/Downloads/instantclient_* | head -1)/*.dylib*; do ln -sf \"$f\" \"$HOME/lib/\"; done && hdiutil detach /Volumes/instantclient-basic-macos.arm64-* && rm -rf /tmp/l8db-ic";

fn oracle_macos_command() -> &'static str {
    if std::env::consts::ARCH == "aarch64" {
        ORACLE_MACOS_ARM64_INSTALL
    } else {
        ORACLE_MACOS_INTEL_INSTALL
    }
}

fn oracle_hints() -> Vec<InstallHint> {
    vec![
        InstallHint { os: "macos", command: oracle_macos_command(), url: "https://www.oracle.com/database/technologies/instant-client/macos-arm64-downloads.html" },
        InstallHint { os: "linux", command: "sudo apt install libaio1 && unzip instantclient-basic-linux.x64-*.zip -d /opt/oracle && echo /opt/oracle/instantclient_* | sudo tee /etc/ld.so.conf.d/oracle.conf && sudo ldconfig", url: "https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html" },
        InstallHint { os: "windows", command: "Instant Client Basic entpacken und den Ordner zur PATH-Variable hinzufügen", url: "https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html" },
    ]
}

fn driver_status(kind: DatabaseKind, driver: Driver) -> DriverStatus {
    let install_command = install_command(kind).ok().map(str::to_string);
    match driver {
        Driver::Builtin => DriverStatus {
            available: true,
            detail: "Eingebetteter Treiber".to_string(),
            install: vec![],
            install_command,
        },
        Driver::RuntimeLibrary { .. } => match oracle::Version::client() {
            Ok(version) => DriverStatus {
                available: true,
                detail: format!("Oracle Client {version}"),
                install: vec![],
                install_command,
            },
            Err(e) => DriverStatus {
                available: false,
                detail: format!("Oracle Instant Client nicht gefunden: {e}"),
                install: oracle_hints(),
                install_command,
            },
        },
        Driver::Odbc { driver } => {
            let status = odbc_environment_status();
            let mut install = odbc_driver_hints(driver);
            match status {
                Ok(drivers) => {
                    if driver.is_empty() || drivers.iter().any(|d| d == driver) {
                        DriverStatus {
                            available: true,
                            detail: format!(
                                "Installierte ODBC-Treiber: {}",
                                if drivers.is_empty() {
                                    "keine".to_string()
                                } else {
                                    drivers.join(", ")
                                }
                            ),
                            install: vec![],
                            install_command,
                        }
                    } else {
                        install.retain(|h| h.os == "all");
                        DriverStatus {
                            available: false,
                            detail: format!(
                                "ODBC-Treiber \"{driver}\" ist nicht registriert. Installiert: {}",
                                if drivers.is_empty() {
                                    "keine".to_string()
                                } else {
                                    drivers.join(", ")
                                }
                            ),
                            install,
                            install_command,
                        }
                    }
                }
                Err(detail) => DriverStatus {
                    available: false,
                    detail,
                    install,
                    install_command,
                },
            }
        }
        Driver::CargoFeature { feature } => {
            let compiled = match feature {
                "duckdb" => cfg!(feature = "duckdb"),
                _ => false,
            };
            DriverStatus {
                available: compiled,
                detail: if compiled {
                    "Eingebetteter Treiber".to_string()
                } else {
                    format!("Nicht in diesem Build enthalten. Build mit: cargo tauri build --features {feature}")
                },
                install: if compiled {
                    vec![]
                } else {
                    vec![InstallHint {
                        os: "all",
                        command: "bun run tauri build -- --features duckdb",
                        url: "https://duckdb.org",
                    }]
                },
                install_command,
            }
        }
    }
}

#[cfg(feature = "odbc")]
fn odbc_environment_status() -> Result<Vec<String>, String> {
    let env = odbc_api::Environment::new()
        .map_err(|e| format!("ODBC-Treibermanager nicht verfügbar: {e}"))?;
    Ok(env
        .drivers()
        .map_err(|e| format!("ODBC-Treiber konnten nicht gelesen werden: {e}"))?
        .into_iter()
        .map(|d| d.description)
        .collect())
}

#[cfg(not(feature = "odbc"))]
fn odbc_environment_status() -> Result<Vec<String>, String> {
    Err("ODBC ist in diesem Build nicht enthalten. Build mit: cargo tauri build --features odbc (benötigt unixODBC)".to_string())
}

pub fn list_providers() -> Vec<ProviderInfo> {
    PROVIDERS
        .iter()
        .map(|p| ProviderInfo {
            id: p.id,
            name: p.name,
            group: p.group,
            kind: p.kind,
            default_port: p.port,
            file_based: p.kind.is_file_based(),
            url_schemes: p.kind.url_schemes(),
            placeholder: p.placeholder,
            hint: p.hint,
            hosts: p.hosts,
            driver: p.driver,
            capabilities: p.kind.capabilities(),
            driver_status: driver_status(p.kind, p.driver),
        })
        .collect()
}

pub fn kind_driver_status(kind: DatabaseKind) -> DriverStatus {
    let driver = PROVIDERS
        .iter()
        .find(|p| p.kind == kind)
        .map(|p| p.driver)
        .unwrap_or(Driver::Builtin);
    driver_status(kind, driver)
}

pub fn install_command(kind: DatabaseKind) -> Result<&'static str, String> {
    match kind {
        DatabaseKind::Oracle => match std::env::consts::OS {
            "macos" => Ok(oracle_macos_command()),
            "linux" => Err("Der Oracle Instant Client lässt sich unter Linux nicht automatisch installieren. Lade ihn von https://www.oracle.com/database/technologies/instant-client/linux-x86-64-downloads.html, entpacke ihn nach /opt/oracle und führe ldconfig aus.".to_string()),
            "windows" => Err("Der Oracle Instant Client lässt sich unter Windows nicht automatisch installieren. Entpacke ihn von https://www.oracle.com/database/technologies/instant-client/winx64-64-downloads.html und füge den Ordner zur PATH-Variable hinzu.".to_string()),
            os => Err(format!("Automatische Installation wird auf {os} nicht unterstützt. Siehe https://www.oracle.com/database/technologies/instant-client/")),
        },
        DatabaseKind::Odbc => {
            if !cfg!(feature = "odbc") {
                return Err("ODBC ist in diesem Build nicht enthalten und kann nicht nachinstalliert werden. Erneut bauen mit: bun run tauri build -- --features odbc (benötigt unixODBC)".to_string());
            }
            match std::env::consts::OS {
                "macos" => Ok("brew install unixodbc"),
                "linux" => Ok("sudo -n apt-get install -y unixodbc unixodbc-dev"),
                "windows" => Err("Der ODBC-Datenquellen-Administrator ist Teil von Windows. Hersteller-Treiber zusätzlich installieren, siehe https://learn.microsoft.com/sql/odbc/admin/odbc-data-source-administrator".to_string()),
                os => Err(format!("Automatische Installation wird auf {os} nicht unterstützt. Siehe https://www.unixodbc.org")),
            }
        }
        DatabaseKind::Duckdb => Err("DuckDB ist in diesem Build nicht enthalten und kann nicht nachinstalliert werden. Erneut bauen mit: bun run tauri build -- --features duckdb".to_string()),
        _ => Err("Dieser Treiber ist eingebettet und bereits verfügbar.".to_string()),
    }
}

pub async fn install_driver(kind: DatabaseKind) -> Result<String, String> {
    let command = install_command(kind)?;
    if std::env::consts::OS == "macos" && command.contains("brew ") {
        let brew = tokio::process::Command::new("sh")
            .arg("-c")
            .arg("command -v brew")
            .output()
            .await
            .map_err(|e| format!("Homebrew-Prüfung fehlgeschlagen: {e}"))?;
        if !brew.status.success() {
            return Err(
                "Homebrew wurde nicht gefunden. Installiere Homebrew von https://brew.sh und versuche es erneut.".to_string(),
            );
        }
    }
    let (shell, flag) = if std::env::consts::OS == "windows" {
        ("cmd", "/C")
    } else {
        ("sh", "-c")
    };
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(600),
        tokio::process::Command::new(shell)
            .arg(flag)
            .arg(command)
            .stdin(std::process::Stdio::null())
            .env("HOMEBREW_NO_AUTO_UPDATE", "1")
            .env("HOMEBREW_NO_ENV_HINTS", "1")
            .output(),
    )
    .await
    .map_err(|_| "Die Installation hat das Zeitlimit von 10 Minuten überschritten.".to_string())?
    .map_err(|e| format!("Installation konnte nicht gestartet werden: {e}"))?;
    let mut log = String::from_utf8_lossy(&output.stdout).into_owned();
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !stderr.trim().is_empty() {
        log.push_str(&stderr);
    }
    let trimmed = log.trim().to_string();
    let mut start = trimmed.len().saturating_sub(6000);
    while start < trimmed.len() && !trimmed.is_char_boundary(start) {
        start += 1;
    }
    let short = trimmed[start..].to_string();
    if output.status.success() {
        let mut result = short;
        let still_missing = !kind_driver_status(kind).available
            && match kind {
                DatabaseKind::Oracle => true,
                DatabaseKind::Odbc => cfg!(feature = "odbc"),
                _ => false,
            };
        if still_missing {
            result.push_str(
                "\n\nHinweis: Die Installation war erfolgreich, der Treiber wird aber noch nicht erkannt. Starte l8db neu und prüfe den Status danach erneut.",
            );
        }
        Ok(result)
    } else {
        Err(format!(
            "Installation fehlgeschlagen ({}):\n{}",
            output.status, short
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn provider_ids_are_unique_and_kinds_covered() {
        let mut ids: Vec<&str> = PROVIDERS.iter().map(|p| p.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), PROVIDERS.len());
        for kind in DatabaseKind::ALL {
            assert!(
                PROVIDERS.iter().any(|p| p.kind == kind),
                "{kind:?} hat keinen Provider"
            );
        }
    }

    #[test]
    fn kinds_serialize_snake_case() {
        assert_eq!(
            serde_json::to_string(&DatabaseKind::Mssql).unwrap(),
            "\"mssql\""
        );
        assert_eq!(
            serde_json::from_str::<DatabaseKind>("\"mongodb\"").unwrap(),
            DatabaseKind::Mongodb
        );
    }

    #[test]
    fn builtin_drivers_report_available() {
        for p in list_providers() {
            if matches!(p.driver, Driver::Builtin) {
                assert!(p.driver_status.available, "{}", p.id);
            }
        }
    }

    #[test]
    fn builtin_kinds_have_no_install_command() {
        assert!(install_command(DatabaseKind::Postgres).is_err());
        assert!(install_command(DatabaseKind::Sqlite).is_err());
        assert!(install_command(DatabaseKind::Mongodb).is_err());
        assert!(kind_driver_status(DatabaseKind::Postgres)
            .install_command
            .is_none());
    }

    #[test]
    fn duckdb_reports_rebuild() {
        let err = install_command(DatabaseKind::Duckdb).unwrap_err();
        assert!(err.contains("duckdb"), "{err}");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_install_commands_use_brew() {
        if std::env::consts::ARCH == "aarch64" {
            let oracle = install_command(DatabaseKind::Oracle).unwrap();
            assert!(
                oracle.contains("instantclient-basic-macos-arm64.dmg"),
                "{oracle}"
            );
            assert!(oracle.contains("$HOME/lib"), "{oracle}");
            assert!(oracle.contains("install_ic.sh"), "{oracle}");
            return;
        }
        let oracle = install_command(DatabaseKind::Oracle).unwrap();
        assert!(oracle.contains("brew tap InstantClientTap/instantclient"));
        assert!(oracle.contains("brew trust instantclienttap/instantclient"));
        assert!(oracle.contains("brew install instantclient-basic"));
        assert!(
            oracle.find("trust") < oracle.find("brew install"),
            "{oracle}"
        );
        assert!(kind_driver_status(DatabaseKind::Oracle)
            .install_command
            .is_some_and(|command| command.contains("brew")));
    }

    #[cfg(all(target_os = "macos", feature = "odbc"))]
    #[test]
    fn macos_odbc_install_command_targets_unixodbc() {
        assert!(install_command(DatabaseKind::Odbc)
            .unwrap()
            .contains("brew install unixodbc"));
    }

    #[cfg(all(target_os = "linux", feature = "odbc"))]
    #[test]
    fn linux_odbc_install_command_targets_unixodbc() {
        assert!(install_command(DatabaseKind::Odbc)
            .unwrap()
            .contains("unixodbc"));
        assert!(install_command(DatabaseKind::Oracle).is_err());
    }

    #[cfg(not(feature = "odbc"))]
    #[test]
    fn odbc_without_feature_reports_rebuild() {
        let err = install_command(DatabaseKind::Odbc).unwrap_err();
        assert!(err.contains("--features odbc"), "{err}");
        assert!(kind_driver_status(DatabaseKind::Odbc)
            .install_command
            .is_none());
    }
}
