import type { SavedConnection } from "@/lib/connections";
import { checksum } from "./model";
import type { DatabaseTarget } from "./types";

function logicalEndpoint(connection: SavedConnection, locationOnly = false) {
  try {
    const url = new URL(connection.connectionString);
    url.password = "";
    if (locationOnly) url.username = "";
    for (const key of [...url.searchParams.keys()])
      if (/password|secret|token/i.test(key)) url.searchParams.delete(key);
    return url.toString();
  } catch {
    return connection.connectionString;
  }
}

export async function bindingForContext(
  connection: SavedConnection,
  target: DatabaseTarget,
  row: Record<string, unknown>,
) {
  const edition = typeof row.edition === "string" ? row.edition : null;
  const location = { ...row };
  delete location.user;
  return {
    locationFingerprint: await checksum(
      JSON.stringify({
        endpoint: logicalEndpoint(connection, true),
        ssh: connection.ssh ?? null,
        kind: connection.kind,
        database: target.database,
        schema: target.schema ?? null,
        context: location,
      }),
    ),
    context: row,
    fingerprint: await checksum(
      JSON.stringify({
        endpoint: logicalEndpoint(connection),
        ssh: connection.ssh ?? null,
        kind: connection.kind,
        database: target.database,
        schema: target.schema ?? null,
        context: row,
      }),
    ),
    physicalKey: await checksum(
      JSON.stringify({
        kind: connection.kind,
        database: row.database,
        server: row.server,
        port: row.port,
        schema: target.ledgerSchema || target.schema,
        edition,
      }),
    ),
    label: `${String(row.user)} @ ${String(row.database)}${row.port ? ` / ${row.port}` : ""}`,
    edition,
  };
}

export function bindingMatches(
  previous: NonNullable<DatabaseTarget["binding"]>,
  current: NonNullable<DatabaseTarget["binding"]>,
): boolean {
  return previous.locationFingerprint
    ? previous.locationFingerprint === current.locationFingerprint
    : previous.fingerprint === current.fingerprint;
}
