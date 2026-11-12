import { create } from "zustand";
import {
  type Capabilities,
  type DatabaseKind,
  type DriverStatus,
  driverStatus,
  listProviders,
  type ProviderInfo,
  type TableTemplate,
  type Terms,
} from "@/lib/db";

export const DEFAULT_TERMS: Terms = {
  database: "Datenbank",
  schema: "Schema",
  table: "Tabelle",
  tables: "Tabellen",
  row: "Zeile",
  rows: "Zeilen",
  column: "Spalte",
  columns: "Spalten",
};

const NO_TEMPLATE: TableTemplate = {
  schema: "",
  id_type: "",
  timestamp_type: "",
  now: "",
  types: [],
};

export const POSTGRES_CAPABILITIES: Capabilities = {
  databases: true,
  schemas: true,
  views: true,
  view_editor: true,
  materialized_views: true,
  functions: true,
  extensions: true,
  roles: true,
  principals: false,
  privileges: true,
  sequences: true,
  enums: true,
  triggers: true,
  indexes: true,
  constraints: true,
  foreign_keys: true,
  rls: true,
  proxy_user: true,
  partitions: true,
  replication: true,
  sessions: true,
  locks: true,
  live_monitor: true,
  transactions: true,
  table_transactions: true,
  row_edit: true,
  ddl: true,
  alter_columns: true,
  explain: true,
  query_stats: true,
  overview: true,
  sql_filter: true,
  read_only_mode: true,
  csv_import: true,
  import_conflicts: true,
  table_copy: true,
  test_data: true,
  column_search: true,
  source_search: true,
  schema_snapshot: true,
  full_table_export: true,
  data_compare: true,
  procedures: true,
  compile_objects: true,
  invalid_objects: false,
  debugger: true,
  bind_parameters: true,
  used_by: true,
  object_grants: false,
  synonyms: false,
  scheduler_jobs: true,
  object_admin: true,
  schema_object_copy: true,
  table_script: true,
  migration_script: true,
  server_output: true,
  query_cancel: true,
  server_info: false,
  dashboard_parallelism: 0,
  ssl: true,
  ssh: true,
  backup: true,
  object_storage: false,
  health_advisor: true,
  dml_preview: true,
  multi_target_query: true,
  multi_target_schemas: true,
  explain_analyze: true,
  packages: false,
  insert_sql: true,
  database_is_schema: false,
  query_language: "sql",
  query_label: "SQL",
  filter_hint: "z. B. status = 'active' AND created_at > '2024-01-01'",
  table_template: {
    schema: "public",
    id_type: "bigserial",
    timestamp_type: "timestamptz",
    now: "now()",
    types: [
      "bigint",
      "bigserial",
      "boolean",
      "bytea",
      "date",
      "double precision",
      "integer",
      "jsonb",
      "numeric",
      "real",
      "serial",
      "smallint",
      "text",
      "time",
      "timestamp",
      "timestamptz",
      "uuid",
      "varchar(255)",
    ],
  },
  terms: DEFAULT_TERMS,
};

const UNAVAILABLE_CAPABILITIES = Object.fromEntries(
  Object.entries(POSTGRES_CAPABILITIES).map(([key, value]) => [
    key,
    typeof value === "boolean" ? false : value,
  ]),
) as unknown as Capabilities;
UNAVAILABLE_CAPABILITIES.table_template = NO_TEMPLATE;

const BASE_CAPABILITIES: Capabilities = {
  ...UNAVAILABLE_CAPABILITIES,
  databases: true,
  schemas: true,
  sql_filter: true,
  ssl: true,
  ssh: true,
};

const SQL_COMMON_CAPABILITIES: Capabilities = {
  ...BASE_CAPABILITIES,
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
  table_script: true,
  csv_import: true,
  import_conflicts: true,
  table_copy: true,
  test_data: true,
  dml_preview: true,
  multi_target_query: true,
  insert_sql: true,
};

const MYSQL_CAPABILITIES: Capabilities = {
  ...SQL_COMMON_CAPABILITIES,
  server_output: true,
  live_monitor: true,
  backup: true,
  query_stats: true,
  sessions: true,
  transactions: true,
  table_transactions: true,
  row_edit: true,
  data_compare: true,
  schema_snapshot: true,
  explain_analyze: true,
  database_is_schema: true,
  terms: { ...DEFAULT_TERMS, schema: "Datenbank" },
};

const FALLBACK_DRIVER: DriverStatus = {
  available: true,
  detail: "Eingebetteter Treiber",
  install: [],
  install_command: null,
};

export const FALLBACK_PROVIDERS: ProviderInfo[] = [
  {
    id: "postgres",
    name: "PostgreSQL",
    group: "Beliebt",
    kind: "postgres",
    default_port: 5432,
    file_based: false,
    url_schemes: ["postgresql", "postgres"],
    placeholder: "postgresql://postgres:password@localhost:5432/postgres",
    hint: "Lokaler Server oder eigener Host.",
    hosts: ["localhost", "127.0.0.1"],
    driver: { type: "builtin" },
    capabilities: POSTGRES_CAPABILITIES,
    driver_status: FALLBACK_DRIVER,
  },
  {
    id: "mysql",
    name: "MySQL",
    group: "Beliebt",
    kind: "mysql",
    default_port: 3306,
    file_based: false,
    url_schemes: ["mysql"],
    placeholder: "mysql://root:password@localhost:3306/mysql",
    hint: "Klassisches MySQL oder kompatible Hosts.",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: MYSQL_CAPABILITIES,
    driver_status: FALLBACK_DRIVER,
  },
  {
    id: "mariadb",
    name: "MariaDB",
    group: "Beliebt",
    kind: "mysql",
    default_port: 3306,
    file_based: false,
    url_schemes: ["mariadb", "mysql"],
    placeholder: "mysql://root:password@localhost:3306/mysql",
    hint: "MariaDB mit eigener visueller Identität.",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: MYSQL_CAPABILITIES,
    driver_status: FALLBACK_DRIVER,
  },
  {
    id: "mongodb",
    name: "MongoDB",
    group: "Beliebt",
    kind: "mongodb",
    default_port: 27017,
    file_based: false,
    url_schemes: ["mongodb", "mongodb+srv"],
    placeholder: "mongodb://localhost:27017",
    hint: "Dokumentenspeicher, lokal oder Atlas.",
    hosts: ["localhost"],
    driver: { type: "builtin" },
    capabilities: {
      ...BASE_CAPABILITIES,
      csv_import: true,
      import_conflicts: true,
      test_data: true,
      backup: true,
      ssl: false,
      indexes: true,
      ddl: true,
      database_is_schema: true,
      query_language: "json",
      query_label: "MongoDB",
      filter_hint: 'MongoDB-Filter als JSON, z. B. {"status": "active"}',
      terms: {
        database: "Datenbank",
        schema: "Datenbank",
        table: "Collection",
        tables: "Collections",
        row: "Dokument",
        rows: "Dokumente",
        column: "Feld",
        columns: "Felder",
      },
    },
    driver_status: FALLBACK_DRIVER,
  },
  {
    id: "sqlite",
    name: "SQLite",
    group: "Beliebt",
    kind: "sqlite",
    default_port: null,
    file_based: true,
    url_schemes: ["sqlite"],
    placeholder: "/pfad/zur/datenbank.sqlite",
    hint: "Eine Datei. Kein Server.",
    hosts: [],
    driver: { type: "builtin" },
    capabilities: {
      ...SQL_COMMON_CAPABILITIES,
      backup: true,
      query_cancel: true,
      databases: false,
      ssl: false,
      ssh: false,
      functions: false,
      transactions: true,
      row_edit: true,
      data_compare: true,
      schema_snapshot: true,
    },
    driver_status: FALLBACK_DRIVER,
  },
];

FALLBACK_PROVIDERS.push(
  {
    id: "jdbc",
    name: "JDBC",
    group: "Weitere Treiber",
    kind: "jdbc",
    default_port: null,
    file_based: false,
    url_schemes: ["jdbc"],
    placeholder: "jdbc:l8db:profil-id",
    hint: "JDBC-Profil unter Treiber anlegen. Benötigt JDK 17 oder neuer und den JDBC-Treiber des Herstellers.",
    hosts: [],
    driver: { type: "runtime_library", library: "JDK 17+ und JDBC-JAR" },
    capabilities: {
      ...UNAVAILABLE_CAPABILITIES,
      schemas: true,
      views: true,
      bind_parameters: true,
      query_cancel: true,
    },
    driver_status: {
      available: false,
      detail:
        "JDBC-Laufzeit noch nicht geprüft. Unter Treiber werden JDK und JDBC-Profile verwaltet.",
      install: [],
      install_command: null,
    },
  },
  {
    id: "workspace",
    name: "Workspace",
    group: "Team",
    kind: "workspace",
    default_port: null,
    file_based: false,
    url_schemes: ["workspace"],
    placeholder: "workspace://profil-id/verbindung-id",
    hint: "Verbindung unter Workspaces hinzufügen. Rechte und Zugangsdaten verwaltet der Workspace-Server.",
    hosts: [],
    driver: { type: "builtin" },
    capabilities: { ...UNAVAILABLE_CAPABILITIES, schemas: true, query_cancel: true },
    driver_status: FALLBACK_DRIVER,
  },
  {
    id: "spacetimedb",
    name: "SpacetimeDB",
    group: "Cloud & HTTP",
    kind: "spacetimedb",
    default_port: null,
    file_based: false,
    url_schemes: ["spacetimedb"],
    placeholder: "spacetimedb://token:identity-token@maincloud.spacetimedb.com/datenbank",
    hint: "SQL-Abfragen sind schreibgeschützt. Das Identity-Token wird als Passwort gespeichert.",
    hosts: ["maincloud.spacetimedb.com"],
    driver: { type: "builtin" },
    capabilities: { ...UNAVAILABLE_CAPABILITIES, dashboard_parallelism: 1 },
    driver_status: FALLBACK_DRIVER,
  },
);

type BooleanCapability = {
  [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never;
}[keyof Capabilities];

interface ProvidersState {
  providers: ProviderInfo[];
  loaded: boolean;
}

export const useProvidersStore = create<ProvidersState>()(() => ({
  providers: FALLBACK_PROVIDERS,
  loaded: false,
}));

let loading: Promise<void> | null = null;

export function loadProviders(): Promise<void> {
  loading ??= listProviders()
    .then((providers) => {
      if (providers.length)
        useProvidersStore.setState({
          providers: providers.map((provider) => ({
            ...provider,
            capabilities: { ...UNAVAILABLE_CAPABILITIES, ...provider.capabilities },
          })),
          loaded: true,
        });
    })
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

export async function refreshDriverStatus(kind: DatabaseKind): Promise<DriverStatus> {
  const status = await driverStatus(kind);
  useProvidersStore.setState((state) => ({
    providers: state.providers.map((provider) =>
      provider.kind === kind ? { ...provider, driver_status: status } : provider,
    ),
  }));
  return status;
}

let retryAfter = 0;

export function allProviders(): ProviderInfo[] {
  const state = useProvidersStore.getState();
  if (!state.loaded && Date.now() > retryAfter) {
    retryAfter = Date.now() + 5000;
    void loadProviders();
  }
  return state.providers;
}

export function providerById(id: string): ProviderInfo | undefined {
  return allProviders().find((provider) => provider.id === id);
}

export function providerForKind(kind: DatabaseKind): ProviderInfo | undefined {
  return allProviders().find((provider) => provider.kind === kind);
}

export function capabilitiesFor(kind: DatabaseKind | null | undefined): Capabilities {
  return (kind && providerForKind(kind)?.capabilities) || UNAVAILABLE_CAPABILITIES;
}

export function supports(
  connection: { kind: DatabaseKind } | null | undefined,
  feature: BooleanCapability,
): boolean {
  return Boolean(connection) && capabilitiesFor(connection?.kind)[feature];
}

export function useCapabilities(kind: DatabaseKind | null | undefined): Capabilities {
  return useProvidersStore(
    (state) =>
      (kind && state.providers.find((provider) => provider.kind === kind)?.capabilities) ||
      UNAVAILABLE_CAPABILITIES,
  );
}
