import { isDateFilterType } from "@/lib/sql-filter";

export function filterAiExamples(
  columns: string[],
  columnDetails?: { name: string; data_type: string }[],
): string[] {
  const date = columnDetails?.find((column) => isDateFilterType(column.data_type))?.name;
  const text = columnDetails?.find((column) =>
    /char|text|string|uuid/i.test(column.data_type),
  )?.name;
  const nullable = text ?? columns[1] ?? columns[0];
  return [
    date ? `Nur Zeilen der letzten 7 Tage (${date})` : null,
    nullable ? `Zeilen ohne ${nullable} rot markieren` : null,
    text && text !== nullable ? `${text} enthält „test“` : null,
    "Alle Filter entfernen",
  ]
    .filter((example): example is string => example !== null)
    .slice(0, 3);
}
