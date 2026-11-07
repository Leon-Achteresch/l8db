import type { DatabaseKind } from "@/lib/db";

export function isProfileConnection(kind: DatabaseKind | undefined): boolean {
  return kind === "jdbc" || kind === "workspace";
}

export function parseProfileConnection(value: string, kind: DatabaseKind): URL {
  const pointer = value.trim();
  if (kind === "jdbc") {
    if (!/^jdbc:l8db:[A-Za-z0-9_-]{1,80}$/.test(pointer))
      throw new Error("Nutze jdbc:l8db:profil-id aus der JDBC-Treiberverwaltung.");
  } else if (
    kind !== "workspace" ||
    !/^workspace:\/\/[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}$/.test(pointer)
  ) {
    throw new Error("Nutze workspace://profil-id/verbindung-id aus den Workspaces.");
  }
  return new URL(pointer);
}
