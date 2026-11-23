import type { DatabaseKind, DetailedColumnInfo } from "@/lib/db";

export function keywordFilterHint(
  kind: DatabaseKind | null | undefined,
  column: DetailedColumnInfo | undefined,
  operator: string,
): { summary: string; details: string } | null {
  if (kind !== "elasticsearch" || !["eq", "neq", "in", "notIn"].includes(operator)) return null;
  if (column && !["text", "keyword"].includes(column.data_type)) return null;
  const metadata = column?.exact_filter;
  const caveat =
    "Ein Nichttreffer beweist nicht, dass der Wert im Dokument fehlt. Indexmodus, indexweite Vorgaben und wirksame Abdeckung sind nicht geprüft; die Anzeige ist kein Nachweis vollständiger Indexierung.";
  if (
    !metadata ||
    typeof metadata.target !== "string" ||
    !metadata.target ||
    metadata.index_mode !== "unverified"
  )
    return {
      summary: "Exaktes Feld / Keyword-Grenze unbekannt",
      details: `Keine passenden strukturierten Mapping-Metadaten vorhanden. Alte Kommentare werden nicht als Grenznachweis gelesen. ${caveat}`,
    };
  const scopeHint =
    metadata.scope === "multiple_indices"
      ? " Mehrere Index-Mappings können abweichende Felder und Grenzen haben."
      : "";
  if (metadata.strategy === "match_phrase")
    return {
      summary: "Exakt verwendet Match-Phrase",
      details: `Für ${metadata.target} wurde kein Keyword-Unterfeld gewählt. Der Filter verwendet eine analysierte Match-Phrase, keine garantierte Rohwertgleichheit.${scopeHint} ${caveat}`,
    };
  if (metadata.strategy !== "keyword")
    return { summary: "Exakter Filterweg unbekannt", details: caveat };
  let limit = "ignore_above unbekannt";
  if (metadata.scope === "multiple_indices") limit = "Grenze bei mehreren Mappings unbekannt";
  else if (metadata.scope === "single_index") {
    const configured = metadata.ignore_above;
    if (
      configured?.state === "configured" &&
      Number.isSafeInteger(configured.value) &&
      configured.value >= 0
    )
      limit = `ignore_above=${configured.value}`;
    else if (configured?.state === "not_declared") limit = "keine Feldgrenze angegeben";
  }
  return {
    summary: `Exakt über ${metadata.target} · ${limit}`,
    details: `Die Anzeige beschreibt das gewählte Keyword-Feld und nur ausdrücklich gelieferte Mapping-Werte. Werte können im Dokument enthalten sein, ohne über dieses Keyword-Feld auffindbar zu sein. Eine fehlende Feldgrenze bedeutet nicht unbegrenzt.${scopeHint} ${caveat}`,
  };
}
