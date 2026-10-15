const SAMPLE_ROWS = 100;
const SAMPLE_COLUMNS = 24;
const NAME_COLUMNS = 120;

const NAME_QUIPS: [RegExp, (column: string) => string][] = [
  [
    /pass(wor)?d|pwd|secret|token|api_?key|hash/i,
    (column) => `„${column}“? Keine Sorge, ich bin verschwiegen wie ein Grab.`,
  ],
  [
    /deleted|gelöscht|geloescht|removed/i,
    (column) => `„${column}“ – hier ruhen die gelöschten Zeilen in Frieden.`,
  ],
  [
    /price|amount|total|revenue|cost|salary|betrag|preis|umsatz|kosten|gehalt/i,
    (column) => `„${column}“ – hoffentlich keine Horrorzahlen.`,
  ],
];

const NUMBER = new Intl.NumberFormat("de-DE");

function shorten(column: string): string {
  return column.length > 28 ? `${column.slice(0, 27)}…` : column;
}

function rowsLabel(count: number): string {
  return `${NUMBER.format(count)} ${count === 1 ? "Zeile" : "Zeilen"}`;
}

export function spiderQuip(
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
  pick = Math.random(),
  date = new Date(),
): string {
  const total = rows.length;
  if (total === 0) return "0 Zeilen. Nicht mal ein Gespenst.";
  if (total === 13) return "Genau 13 Zeilen. Ich sag ja nur.";
  if (total === 666) return "666 Zeilen. Ich klettere dann mal wieder hoch.";
  const named = columns.slice(0, NAME_COLUMNS);
  const sampled = columns.slice(0, SAMPLE_COLUMNS);
  const sampleRows = Math.min(total, SAMPLE_ROWS);
  let nulls = 0;
  for (let index = 0; index < sampleRows; index++) {
    const row = rows[index];
    for (const column of sampled) if (row[column] == null) nulls++;
  }
  const cells = sampleRows * sampled.length;
  const candidates: string[] = [];
  for (const [pattern, quip] of NAME_QUIPS) {
    const column = named.find((name) => pattern.test(name));
    if (column) candidates.push(quip(shorten(column)));
  }
  if (columns.length === 8) candidates.push("Acht Spalten – genau wie meine Beine.");
  else if (columns.length > 8)
    candidates.push(`${NUMBER.format(columns.length)} Spalten und ich hab nur acht Beine.`);
  if (cells >= 20 && nulls / cells >= 0.25)
    candidates.push(`${Math.round((nulls / cells) * 100)} % NULL. Hier spukt es gewaltig.`);
  if (cells >= 50 && nulls === 0) candidates.push("Keine einzige NULL. Verdächtig sauber.");
  if (total === 1) candidates.push("Eine einzige Zeile. Ganz schön einsam hier.");
  if (total >= 10_000) candidates.push(`${rowsLabel(total)}. Da verheddert sich jede Spinne.`);
  if (date.getHours() >= 22 || date.getHours() < 5)
    candidates.push("Nachtschicht? Ich bin auch nachtaktiv.");
  candidates.push(
    `${rowsLabel(total)} durchgesehen. Keine Leichen im Keller.`,
    "Alles durchgesehen. Keine Bugs gefunden – außer mir.",
  );
  return candidates[Math.min(candidates.length - 1, Math.floor(pick * candidates.length))];
}
