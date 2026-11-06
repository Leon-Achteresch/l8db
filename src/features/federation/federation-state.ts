import { FEDERATION_LIMITS, type FederationSource } from "@/lib/db/federation-types";

export function newFederationSource(sources: FederationSource[]): FederationSource {
  const aliases = new Set(sources.map((source) => source.alias.toLowerCase()));
  let index = 1;
  while (aliases.has(`quelle${index}`)) index++;
  return { connectionId: "", database: null, schema: "", table: "", alias: `quelle${index}` };
}

export function federationProblem(sources: FederationSource[], sql: string): string | null {
  if (sources.length === 0 || sources.length > FEDERATION_LIMITS.sources)
    return `Zwischen 1 und ${FEDERATION_LIMITS.sources} Quelltabellen auswählen.`;
  if (!sql.trim()) return "Eine SQL-Abfrage eingeben.";
  if (new TextEncoder().encode(sql).length > FEDERATION_LIMITS.sqlBytes)
    return "Die SQL-Abfrage darf höchstens 64 KiB groß sein.";
  const aliases = new Map<string, string>();
  const tables = new Set<string>();
  for (const source of sources) {
    if (!source.connectionId || !source.schema || !source.table)
      return "Für jede Quelle Verbindung, Schema und Tabelle auswählen.";
    if (
      !/^[a-z][a-z0-9_]{0,31}$/i.test(source.alias) ||
      /^(main|temp)$/i.test(source.alias) ||
      /^sqlite_/i.test(source.alias)
    )
      return "Aliase beginnen mit einem Buchstaben und enthalten höchstens 32 Buchstaben, Ziffern oder Unterstriche.";
    const alias = source.alias.toLowerCase();
    const origin = JSON.stringify([source.connectionId, source.database, source.schema]);
    if (aliases.has(alias) && aliases.get(alias) !== origin)
      return `Alias „${source.alias}“ bezeichnet unterschiedliche Datenbanken oder Schemas.`;
    aliases.set(alias, origin);
    const table = `${alias}\u0000${source.table.toLowerCase()}`;
    if (tables.has(table)) return `Quelle ${source.alias}.${source.table} ist doppelt ausgewählt.`;
    tables.add(table);
  }
  return null;
}

export function federationExample(sources: FederationSource[]): string {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const source = sources.find((source) => source.table && source.alias);
  return source
    ? `SELECT *\nFROM ${quote(source.alias)}.${quote(source.table)}\nLIMIT 100;`
    : "SELECT *\nFROM quelle1.kunden\nLIMIT 100;";
}

export function federationNameOptions(
  options: string[],
  value: string,
  display: (value: string) => string = (value) => value,
): string[] {
  const query = value.trim().toLowerCase();
  const result: string[] = [];
  for (const option of options) {
    if (query && !display(option).toLowerCase().includes(query)) continue;
    result.push(option);
    if (result.length >= 100) break;
  }
  return result;
}
