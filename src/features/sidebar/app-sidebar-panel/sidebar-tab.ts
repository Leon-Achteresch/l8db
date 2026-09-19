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

export function sidebarTabLabel(sidebarTab: SidebarTabValue): string {
  return sidebarTab === "tables"
    ? "Tabellen"
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
                ? "Packages"
                : sidebarTab === "roles"
                  ? "Benutzer & Rollen"
                  : sidebarTab === "sequences"
                    ? "Sequenzen"
                    : "Gespeicherte Queries";
}
