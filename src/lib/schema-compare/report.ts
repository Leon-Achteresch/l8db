import { ATTRIBUTE_LABELS } from "./diff";
import type { SyncScript } from "./script";
import {
  type CompareFlag,
  type CompareResult,
  compareTypesFor,
  type DiffItem,
  OBJECT_TYPE_META,
} from "./types";

export const MAX_REPORT_ITEMS = 20_000;
export const MAX_REPORT_CHARS = 4 * 1024 * 1024;

const OPTION_LABELS: Record<CompareFlag, string> = {
  ignoreWhitespace: "Leerraum",
  ignoreCase: "Groß-/Kleinschreibung",
  ignoreSystemNames: "Systemgenerierte Namen",
  ignoreSequenceValues: "Aktuelle Sequenzwerte",
  ignoreComments: "Kommentare im Quelltext",
  ignoreQuotes: "Anführungszeichen einfacher Namen",
  ignoreDefaultNull: "DEFAULT NULL",
  ignoreTimestampPrecision: "Zeitstempelgenauigkeit",
  ignoreLengthSemantics: "BYTE-/CHAR-Länge",
  ignoreConstraintNames: "Constraint-Namen",
  ignoreColumnOrder: "Spaltenreihenfolge",
  ignoreTablespace: "Tablespaces",
};

function literal(value: string): string {
  if (value.length > 16_384) throw new Error("Ein Berichtstext ist zu lang. Vergleich eingrenzen.");
  const text = JSON.stringify(value).replace(
    /[\u2028-\u202e\u2066-\u2069]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  let longest = 0;
  for (const run of text.matchAll(/`+/g)) longest = Math.max(longest, run[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

function objectLabel(item: DiffItem): string {
  return `${OBJECT_TYPE_META[item.type].label} ${literal(item.name)}${item.parent ? ` in ${literal(item.parent)}` : ""}`;
}

export function buildSchemaChangeReport(result: CompareResult, script: SyncScript): string {
  if (result.items.length > MAX_REPORT_ITEMS)
    throw new Error("Zu viele Vergleichseinträge für einen Bericht. Vergleich eingrenzen.");
  const lines: string[] = [];
  let size = 0;
  const add = (line = "") => {
    size += line.length + 1;
    if (size > MAX_REPORT_CHARS) throw new Error("Bericht zu groß. Vergleich eingrenzen.");
    lines.push(line);
  };
  const counts = { only_source: 0, only_target: 0, different: 0, identical: 0 };
  for (const item of result.items) counts[item.status]++;
  const changes = counts.only_source + counts.only_target + counts.different;
  const critical = new Set(
    script.statements.filter((step) => step.dangerous).map((step) => step.key),
  );
  add("# Schemaänderungsbericht");
  add();
  add(`- Quelle (gewünschter Stand): ${literal(result.sourceLabel)}`);
  add(`- Ziel (zu prüfender Stand): ${literal(result.targetLabel)}`);
  add(
    `- Richtung: Ziel ${literal(result.targetSchema)} an Quelle ${literal(result.sourceSchema)} angleichen.`,
  );
  add(`- Datenbankfamilie: ${literal(result.kind)}`);
  add(`- Verglichen am: ${literal(result.comparedAt || "Zeitpunkt unbekannt")}`);
  for (const [label, side, snapshotAt] of [
    ["Quelle", result.source, result.snapshotTimes?.source],
    ["Ziel", result.target, result.snapshotTimes?.target],
  ] as const) {
    if (side.snapshot)
      add(
        `- ${label}: Snapshot vom ${literal(snapshotAt || "Zeitpunkt unbekannt")}; keine aktuelle Live-Prüfung.`,
      );
  }
  add();
  add(
    "Standbericht über gelesene Metadaten. Keine Migration ausgeführt oder bestätigt; keine Garantie für den heutigen Datenbankstand.",
  );
  add();
  add("## Geprüfter Umfang und Grenzen");
  add();
  add(
    `- Verglichene Objekttypen: ${result.types.map((type) => OBJECT_TYPE_META[type].plural).join(", ") || "keine"}. Spalten sind bei Tabellen eingeschlossen.`,
  );
  const missing = compareTypesFor(result.kind).filter((type) => !result.types.includes(type));
  add(
    `- Nicht verglichen (nicht gewählt oder im Snapshot fehlend): ${missing.map((type) => OBJECT_TYPE_META[type].plural).join(", ") || "keine weiteren vom Client angebotenen Typen"}.`,
  );
  for (const side of ["source", "target"] as const) {
    const label = side === "source" ? "Quelle" : "Ziel";
    const tables = result.tableScope?.[side];
    add(
      `- Tabellenumfang ${label}: ${tables === undefined ? "unbekannt (älterer Vergleich)" : tables === null ? "keine explizite Tabellenliste eingeschränkt" : tables.length === 0 ? "leere Tabellenliste" : tables.map(literal).join(", ")}.`,
    );
  }
  add(
    "- Bei eingeschränkten Snapshot-Tabellenlisten wird nur deren gemeinsamer Tabellenumfang verglichen.",
  );
  const ignored = Object.entries(OPTION_LABELS)
    .filter(([key]) => result.options[key as CompareFlag])
    .map(([, label]) => label);
  add(`- Ignorierte Unterschiede: ${ignored.join(", ") || "keine"}.`);
  add(`- Ausschlussmuster: ${literal(result.options.excludePatterns || "keine")}.`);
  add(
    `- Unterschiedslimit: ${result.options.diffLimit > 0 ? result.options.diffLimit : "keines"}; ausgelassene Unterschiede: ${result.omitted ?? "unbekannt"}.`,
  );
  if (result.omitted === undefined)
    add(
      "- Älterer Vergleich: Ob und wie viele Unterschiede durch ein Limit fehlen, ist unbekannt.",
    );
  if (result.omitted)
    add(
      "- UNVOLLSTÄNDIG: Weitere Unterschiede fehlen. Kein vollständiger Gleichheitsbefund oder vollständiger Änderungsplan möglich.",
    );
  add(
    "- Vollständigkeit und Sichtbarkeit des Serverkatalogs sind nicht nachgewiesen. Nicht gelieferte oder nicht unterstützte Bereiche, Dateninhalte, fachliche Folgen und Laufzeitabhängigkeiten sind nicht geprüft.",
  );
  add(
    "- Alle gespeicherten Vergleichseinträge zählen; Such-/Ansichtsfilter und Skriptauswahl begrenzen diesen Bericht nicht. Tabellen können zugehörige Unterobjekte bündeln.",
  );
  add();
  add("## Ergebnis");
  add();
  add(
    `- ${changes} abweichende Einträge: ${counts.only_source} nur in Quelle, ${counts.only_target} nur im Ziel, ${counts.different} unterschiedlich; ${counts.identical} identisch nach Vergleichsoptionen.`,
  );
  if (changes === 0)
    add(
      result.omitted === undefined || result.omitted > 0
        ? "Keine Unterschiede in den behaltenen Einträgen; der Vergleich ist unvollständig."
        : "Keine Unterschiede im erfassten Umfang nach den genannten Vergleichsoptionen. Keine Aussage über nicht verglichene Bereiche.",
    );
  add();
  for (const item of result.items) {
    if (item.status === "identical") continue;
    const action =
      item.status === "only_source"
        ? "Fehlt im Ziel"
        : item.status === "only_target"
          ? "Nur im Ziel"
          : "Unterschiedlich";
    add(`- **${action}:** ${objectLabel(item)}.`);
    if (item.status === "only_source")
      add(
        "  Im erfassten Ziel nicht vorhanden. Erstellen oder bewusste Umbenennung eines vorhandenen Objekts prüfen.",
      );
    if (item.status === "only_target")
      add(
        "  **Potenziell destruktiv:** Ein Löschen dieses Zielobjekts könnte Daten, Rechte oder abhängige Objekte entfernen. Eine bewusste Umbenennung kann eine andere Vorgehensweise sein.",
      );
    if (item.status === "different") {
      add(
        `  Geänderte Merkmale: ${item.differsBy.map(literal).join(", ") || "nicht näher aufgeschlüsselt"}.`,
      );
      for (const [key, label] of Object.entries(ATTRIBUTE_LABELS)) {
        if (!item.differsBy.includes(label)) continue;
        const before = item.target?.attributes[key];
        const after = item.source?.attributes[key];
        if (before === undefined && after === undefined) continue;
        add(
          `  ${label}: Ziel ${before === undefined ? "nicht angegeben" : literal(before)} → Quelle ${after === undefined ? "nicht angegeben" : literal(after)}.`,
        );
      }
      add("  Auswirkungen und Datenverlustrisiko sind nicht vollständig bewertet.");
    }
    if (item.children.length > 0 && item.status !== "different")
      add(`  ${item.children.length} zugehörige Unterobjekte sind im Vergleich gebündelt.`);
    if (item.blocked) add(`  **Synchronisation gesperrt:** ${literal(item.blocked)}.`);
    if (critical.has(item.key))
      add("  **Im aktuellen ausgewählten SQL-Plan als kritisch markiert.**");
  }
  add();
  add("## Aktuelle Skriptauswahl (nicht ausgeführt)");
  add();
  add(
    `${script.statements.length} vorbereitete Anweisungen, davon ${script.statements.filter((step) => step.dangerous).length} kritisch markiert. Nicht ausgewählte oder nicht erzeugbare Änderungen sind damit nicht als sicher bewertet. Manuelle Umbenennungszuordnungen betreffen den SQL-Plan; die Vergleichseinträge oben bleiben unverändert.`,
  );
  for (const warning of script.warnings) add(`- Hinweis: ${literal(warning)}`);
  add();
  return lines.join("\n");
}
