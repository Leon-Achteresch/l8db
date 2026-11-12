import type { Terms } from "@/lib/db";

export type SidebarTabValue =
  | "tables"
  | "views"
  | "queries"
  | "functions"
  | "procedures"
  | "packages"
  | "synonyms"
  | "extensions"
  | "roles"
  | "sequences";

export function sidebarTabLabel(sidebarTab: SidebarTabValue, terms: Terms): string {
  return sidebarTab === "tables"
    ? terms.tables
    : sidebarTab === "views"
      ? "Views"
      : sidebarTab === "functions"
        ? "Funktionen"
        : sidebarTab === "procedures"
          ? "Prozeduren"
          : sidebarTab === "packages"
            ? "Packages"
            : sidebarTab === "synonyms"
              ? "Synonyme"
              : sidebarTab === "extensions"
                ? "Erweiterungen"
                : sidebarTab === "roles"
                  ? "Benutzer & Rollen"
                  : sidebarTab === "sequences"
                    ? "Sequenzen"
                    : "Gespeicherte Abfragen";
}
