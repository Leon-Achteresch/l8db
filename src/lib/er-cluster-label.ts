import type { ERTable } from "@/lib/db";
import { erTableKeyOf } from "@/lib/er-focus";

const genericWords = new Set([
  "t",
  "tb",
  "tbl",
  "table",
  "tables",
  "pk",
  "fk",
  "id",
  "ref",
  "map",
  "link",
  "links",
  "rel",
  "relation",
  "relations",
  "tmp",
  "temp",
  "v",
  "view",
  "app",
  "db",
  "dbo",
  "public",
  "col",
  "column",
  "parent",
  "name",
  "created",
  "updated",
  "deleted",
  "at",
  "date",
  "time",
  "uuid",
  "key",
  "type",
  "status",
  "value",
  "data",
]);
const entityNames: Record<string, string> = {
  user: "Benutzer",
  role: "Rollen",
  permission: "Rechte",
  session: "Sitzungen",
  account: "Konten",
  auth: "Zugriff",
  order: "Bestellungen",
  item: "Positionen",
  customer: "Kunden",
  product: "Produkte",
  invoice: "Rechnungen",
  payment: "Zahlungen",
  project: "Projekte",
  task: "Aufgaben",
  team: "Teams",
  organization: "Organisationen",
  document: "Dokumente",
  comment: "Kommentare",
  post: "Beiträge",
  category: "Kategorien",
  categories: "Kategorien",
  inventory: "Bestand",
  warehouse: "Lager",
  stock: "Bestand",
  event: "Ereignisse",
  audit: "Protokolle",
  log: "Protokolle",
  notification: "Benachrichtigungen",
  file: "Dateien",
  media: "Medien",
  report: "Berichte",
  sales: "Verkauf",
  address: "Adressen",
  addresses: "Adressen",
  contact: "Kontakte",
};

function titleCase(word: string): string {
  return word.charAt(0).toLocaleUpperCase("de") + word.slice(1);
}

function entityTerms(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .toLocaleLowerCase("de")
    .split(/[^\p{L}]+/u)
    .filter((word) => word.length > 1 && !genericWords.has(word))
    .map((word) => entityNames[word] ?? entityNames[word.replace(/s$/, "")] ?? titleCase(word));
}

export function createErClusterLabel(
  tables: ERTable[],
  degrees: Map<string, number>,
  index: number,
  isolated: boolean,
): string {
  const terms = new Map<string, number>();
  for (const table of tables) {
    const tableTerms = entityTerms(table.name);
    const names = new Set(
      tableTerms.length > 0
        ? tableTerms
        : table.columns.flatMap((column) => entityTerms(column.name)),
    );
    for (const name of names)
      terms.set(
        name,
        (terms.get(name) ?? 0) + 2 + Math.sqrt(degrees.get(erTableKeyOf(table)) ?? 0),
      );
  }
  const ranked = [...terms]
    .sort(([a, weightA], [b, weightB]) => weightB - weightA || a.localeCompare(b, "de"))
    .map(([term]) => term);
  if (ranked.length >= 2) return ranked.slice(0, 2).join(" & ");
  const schema = titleCase(tables[0]?.schema ?? "Schema");
  return (
    (ranked[0] ?? schema) +
    " · " +
    (isolated ? "Tabellengruppe " : "Beziehungsgruppe ") +
    (index + 1)
  );
}
