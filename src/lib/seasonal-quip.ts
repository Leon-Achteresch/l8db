import { HOLIDAY_BY_ID, type HolidayId } from "@/lib/seasonal-calendar";
import { spiderQuip } from "@/lib/spider-quip";

export function seasonalQuip(
  holiday: HolidayId,
  columns: readonly string[],
  rows: readonly Record<string, unknown>[],
  pick = Math.random(),
  date = new Date(),
): string {
  if (holiday === "halloween") return spiderQuip(columns, rows, pick, date);
  const quip = HOLIDAY_BY_ID[holiday].quip;
  if (holiday === "remembrance" || pick < 0.65) return quip;
  if (rows.length === 0) {
    if (holiday === "easter") return "Keine Zeilen? Die hast du aber gut versteckt.";
    if (holiday === "christmas")
      return "Noch nichts unterm Baum? Das Christkind führt die Abfrage gleich aus.";
    return "Hier ist noch Platz. Ich halte dir ein gemütliches Zeilchen frei.";
  }
  if (holiday === "valentine" && rows.length === 1)
    return "Eine Zeile. Mein persönlicher Lieblings-Single.";
  if (holiday === "easter")
    return `${rows.length.toLocaleString("de-DE")} Zeilen gefunden. Du bist besser im Suchen als ich!`;
  if (holiday === "new-year")
    return "Die Abfrage läuft. Mein Vorsatz, mehr Sport zu machen, noch nicht.";
  return quip;
}
