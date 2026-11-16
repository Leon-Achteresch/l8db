import type { SavedConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import {
  productFromProbe,
  rememberServerProduct,
  SERVER_PRODUCT_PROBES,
} from "@/lib/server-products";
import { effectiveConnectionString } from "./connection-string";

export async function detectServerProduct(connection: SavedConnection): Promise<void> {
  const probe = SERVER_PRODUCT_PROBES[connection.kind];
  if (!probe) return;
  try {
    const result = await executeQuery(
      connection.kind,
      effectiveConnectionString(connection),
      probe,
      undefined,
      { track: false, queryTimeout: 10 },
    );
    rememberServerProduct(
      connection.connectionString,
      productFromProbe(connection.kind, result.rows),
    );
  } catch {
    return;
  }
}
