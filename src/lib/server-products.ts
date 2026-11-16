import { create } from "zustand";
import type { DatabaseKind } from "@/lib/db/providers";

export const useServerProducts = create<{ products: Record<string, string> }>(() => ({
  products: {},
}));

export const SERVER_PRODUCT_PROBES: Partial<Record<DatabaseKind, string>> = {
  postgres:
    "SELECT version() AS version, EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') AS timescale",
  redis: "INFO server",
};

export function productFromProbe(
  kind: DatabaseKind,
  rows: Record<string, unknown>[],
): string | null {
  const text = JSON.stringify(rows);
  if (kind === "postgres") {
    if (String(rows[0]?.version ?? "").startsWith("CockroachDB")) return "cockroachdb";
    return rows[0]?.timescale === true ? "timescale" : null;
  }
  if (kind === "redis") {
    if (text.includes("dragonfly_version")) return "dragonfly";
    if (text.includes("valkey_version")) return "valkey";
  }
  return null;
}

export function serverProduct(connectionString: string): string | undefined {
  return useServerProducts.getState().products[connectionString];
}

export function rememberServerProduct(connectionString: string, product: string | null): void {
  useServerProducts.setState((state) => {
    if ((state.products[connectionString] ?? null) === product) return state;
    const products = { ...state.products };
    if (product) products[connectionString] = product;
    else delete products[connectionString];
    return { products };
  });
}
