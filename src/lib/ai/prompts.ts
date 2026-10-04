export const AI_KNOWLEDGE_PROMPT =
  "Sieh dir alle Tabellen dieser Datenbank an und beschreibe jede Tabelle und ihre wichtigsten Spalten in einfachen Worten. Speichere die Beschreibungen mit dem knowledge-Tool. Ergänze typische Fachbegriffe als Glossar, wenn sie sich aus den Daten ergeben. Fasse am Ende kurz zusammen, was du gespeichert hast.";

const FAVORITES =
  /order|bestell|sale|verkauf|invoice|rechnung|customer|kunde|user|nutzer|product|produkt|payment|zahlung|event|transaction|buchung|ticket|employee|mitarbeit/i;

export function aiSuggestions(tables: string[]): string[] {
  const base = [...new Set(tables)].filter((name) => !/^(_|pg_|sqlite_|sys)/i.test(name));
  const picks = [
    ...base.filter((name) => FAVORITES.test(name)),
    ...base.filter((name) => !FAVORITES.test(name)),
  ];
  const [first, second] = picks;
  const questions = ["Was steht in dieser Datenbank? Erklär mir die wichtigsten Tabellen."];
  if (first) questions.push(`Wie haben sich die Einträge in ${first} pro Monat entwickelt?`);
  if (second ?? first) questions.push(`Zeig mir die 10 neuesten Einträge aus ${second ?? first}.`);
  if (first) questions.push(`Gibt es in ${first} auffällige oder fehlende Werte?`);
  return questions;
}
