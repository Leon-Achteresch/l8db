import { create } from "zustand";
import {
  type Capabilities,
  type DatabaseKind,
  type DriverStatus,
  driverStatus,
  listProviders,
  type ProviderInfo,
} from "@/lib/db";

export const POSTGRES_CAPABILITIES: Capabilities = {
  databases: true,
  schemas: true,
  views: true,
  view_editor: true,
  materialized_views: true,
  functions: true,
  extensions: true,
  roles: true,
  privileges: true,
  sequences: true,
  enums: true,
  triggers: true,
  indexes: true,
  constraints: true,
  foreign_keys: true,
  rls: true,
  partitions: true,
  replication: true,
  sessions: true,
  locks: true,
  transactions: true,
  row_edit: true,
  ddl: true,
  alter_columns: true,
  explain: true,
  overview: true,
  sql_filter: true,
  ssl: true,
  ssh: true,
  query_language: "sql",
  filter_hint: "SQL WHERE-Ausdruck",
};

export const FALLBACK_PROVIDERS: ProviderInfo[] = [
  {
    id: "postgres",
    name: "PostgreSQL",
    group: "PostgreSQL-kompatibel",
    kind: "postgres",
    default_port: 5432,
    file_based: false,
    url_schemes: ["postgresql", "postgres"],
    placeholder: "postgresql://postgres:password@localhost:5432/postgres",
    hint: "Lokaler Server oder eigener Host.",
    hosts: ["localhost", "127.0.0.1"],
    driver: { type: "builtin" },
    capabilities: POSTGRES_CAPABILITIES,
    driver_status: { available: true, detail: "Eingebetteter Treiber", install: [] },
  },
];

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

export async function loadProviders(): Promise<void> {
  try {
    const providers = await listProviders();
    if (providers.length) useProvidersStore.setState({ providers, loaded: true });
  } catch {
    return;
  }
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

export function allProviders(): ProviderInfo[] {
  return useProvidersStore.getState().providers;
}

export function providerById(id: string): ProviderInfo | undefined {
  return allProviders().find((provider) => provider.id === id);
}

export function providerForKind(kind: DatabaseKind): ProviderInfo | undefined {
  return allProviders().find((provider) => provider.kind === kind);
}

export function capabilitiesFor(kind: DatabaseKind | null | undefined): Capabilities {
  return (kind && providerForKind(kind)?.capabilities) || POSTGRES_CAPABILITIES;
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
      POSTGRES_CAPABILITIES,
  );
}
