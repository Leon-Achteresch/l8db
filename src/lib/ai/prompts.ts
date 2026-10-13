export const AI_KNOWLEDGE_PROMPT =
  "Sieh dir alle Tabellen dieser Datenbank an und beschreibe jede Tabelle und ihre wichtigsten Spalten in einfachen Worten. Speichere die Beschreibungen mit dem knowledge-Tool. Ergänze typische Fachbegriffe als Glossar, wenn sie sich aus den Daten ergeben. Fasse am Ende kurz zusammen, was du gespeichert hast.";

export const AI_RULES_PROMPT =
  "Finde die Geschäftsregeln, die in dieser Datenbank gelten sollten. Profiliere die wichtigsten Tabellen mit Aggregatabfragen (Pflichtfelder, Eindeutigkeit, Wertebereiche, Abhängigkeiten zwischen Status und Datum, Summen, die zu Positionen passen müssen) und formuliere Kandidaten als Abfragen, die verletzende Zeilen liefern. Prüfe sie mit dem rules-Tool und zeig mir, welche gelten, welche fast gelten und wo genau Verletzungen stecken, mit seit wann sie auftreten. Speichere danach die Regeln, die ich bestätige.";

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
  if (first)
    questions.push(`Warum hat sich ${first} im letzten Monat gegenüber dem Vormonat verändert?`);
  if (second ?? first)
    questions.push(
      `Was wäre, wenn wir ${second ?? first} ändern? Spiel es in der Sandbox durch, ohne etwas zu speichern.`,
    );
  if (first) questions.push("Welche Regeln gelten in meinen Daten, und wo werden sie verletzt?");
  return questions;
}
