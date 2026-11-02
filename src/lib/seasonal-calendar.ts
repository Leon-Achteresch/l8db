export const HOLIDAYS = [
  {
    id: "new-year",
    name: "Silvester & Neujahr",
    period: "31. Dezember – 2. Januar",
    guest: "Rudi Rakete",
    color: "#ed967e",
    quip: "Neues Jahr, frische Zeilen. Die alten Vorsätze liegen im Backup.",
  },
  {
    id: "epiphany",
    name: "Heilige Drei Könige",
    period: "6. Januar",
    guest: "Sternchen",
    color: "#e8bc61",
    quip: "Ich folge dem Stern. Der Query Planner nimmt wieder einen anderen Weg.",
  },
  {
    id: "valentine",
    name: "Valentinstag",
    period: "13. – 14. Februar",
    guest: "Herzbert",
    color: "#e99cae",
    quip: "Du und ich? Das wäre ein ziemlich guter JOIN.",
  },
  {
    id: "carnival",
    name: "Karneval",
    period: "Karnevalssamstag – Faschingsdienstag",
    guest: "Konfetti-Küken",
    color: "#b6a1df",
    quip: "Heute tragen sogar die Tabellen einen Alias. Helau!",
  },
  {
    id: "women-day",
    name: "Weltfrauentag",
    period: "8. März",
    guest: "Milla Mimose",
    color: "#e9c560",
    quip: "Ein kleiner Blumengruß für die großen Dinge, die du bewegst.",
  },
  {
    id: "easter",
    name: "Ostern",
    period: "Palmsonntag – Ostermontag",
    guest: "Hops",
    color: "#9bcbb3",
    quip: "Ich hab ein Ei versteckt. WHERE verrate ich aber nicht.",
  },
  {
    id: "labour-day",
    name: "Tag der Arbeit",
    period: "1. Mai",
    guest: "Biene Feierabend",
    color: "#e5bc64",
    quip: "Auch fleißige Bienchen brauchen mal ein COMMIT und eine Pause.",
  },
  {
    id: "mothers-day",
    name: "Muttertag",
    period: "Zweiter Sonntag im Mai",
    guest: "Blümchen",
    color: "#e6a2b4",
    quip: "Danke fürs Großziehen. Auch die kleinen Tabellen sind schon gewachsen.",
  },
  {
    id: "fathers-day",
    name: "Himmelfahrt & Vatertag",
    period: "39 Tage nach Ostersonntag",
    guest: "Papa Bär",
    color: "#bba086",
    quip: "Ich kenne einen guten Datenbankwitz. Aber der hat zu viele Beziehungen.",
  },
  {
    id: "pentecost",
    name: "Pfingsten",
    period: "Pfingstsonntag & Pfingstmontag",
    guest: "Wölkchen",
    color: "#a7c8e0",
    quip: "Ein freier Tag, eine kleine Wolke und endlich etwas Luft zwischen den Abfragen.",
  },
  {
    id: "corpus-christi",
    name: "Fronleichnam",
    period: "60 Tage nach Ostersonntag",
    guest: "Sonnenblümchen",
    color: "#e5c171",
    quip: "Ein kleiner Feiertagsgruß. Heute darf alles ein bisschen langsamer wachsen.",
  },
  {
    id: "assumption",
    name: "Mariä Himmelfahrt",
    period: "15. August",
    guest: "Marie Käfer",
    color: "#df968a",
    quip: "Ein bisschen Sommerglück. Ich passe derweil auf dein Blättchen auf.",
  },
  {
    id: "unity",
    name: "Tag der Deutschen Einheit",
    period: "3. Oktober",
    guest: "Pünktchen & Anton",
    color: "#a5bde0",
    quip: "Zusammen sind wir ein UNION ALL. Hier geht niemand verloren.",
  },
  {
    id: "halloween",
    name: "Halloween & Reformationstag",
    period: "18. – 31. Oktober",
    guest: "Die Datenspinne",
    color: "#dba47e",
    quip: "Alles durchgesehen. Keine Bugs gefunden – außer mir.",
  },
  {
    id: "remembrance",
    name: "Stille Feiertage",
    period: "Allerheiligen & Buß- und Bettag",
    guest: "Lichtblick",
    color: "#d8ba83",
    quip: "Ein kleines Licht und ein ruhiger Moment. Schön, dass du da bist.",
  },
  {
    id: "martin",
    name: "Sankt Martin",
    period: "11. November",
    guest: "Lumi Laterne",
    color: "#e7b86a",
    quip: "Ich geh mit meiner Laterne. Du gehst mit deinem SELECT.",
  },
  {
    id: "advent",
    name: "Advent",
    period: "Erster Advent – 23. Dezember",
    guest: "Zimtstern",
    color: "#c9aa86",
    quip: "Nur noch ein Query. Und ein Plätzchen. Und noch ein Query.",
  },
  {
    id: "nicholas",
    name: "Nikolaus",
    period: "5. – 6. Dezember",
    guest: "Stiefelchen",
    color: "#db958b",
    quip: "Stiefel geputzt, Cache geleert. Jetzt ist Platz für was Süßes.",
  },
  {
    id: "christmas",
    name: "Weihnachten",
    period: "24. – 26. Dezember",
    guest: "Tanni",
    color: "#91bea6",
    quip: "O Tannenbaum, o Tannenbaum, wie schön sind deine B-Tree-Blätter.",
  },
] as const;

export type HolidayId = (typeof HOLIDAYS)[number]["id"];
export type Holiday = (typeof HOLIDAYS)[number];

export const HOLIDAY_BY_ID = Object.fromEntries(
  HOLIDAYS.map((holiday) => [holiday.id, holiday]),
) as Record<HolidayId, Holiday>;

export function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const value = h + l - 7 * m + 114;
  return new Date(year, Math.floor(value / 31) - 1, (value % 31) + 1);
}

function calendarDay(date: Date): number {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

export function holidayForDate(date: Date): HolidayId | null {
  if (!Number.isFinite(date.getTime())) return null;
  const month = date.getMonth() + 1;
  const day = date.getDate();
  if ((month === 1 && day <= 2) || (month === 12 && day === 31)) return "new-year";
  if (month === 1 && day === 6) return "epiphany";
  if (month === 2 && day >= 13 && day <= 14) return "valentine";
  if (month === 3 && day === 8) return "women-day";
  if (month === 5 && day === 1) return "labour-day";
  if (month === 8 && day === 15) return "assumption";
  if (month === 10 && day === 3) return "unity";
  if (month === 10 && day >= 18) return "halloween";
  if (month === 11 && (day === 1 || (day >= 16 && day <= 22 && date.getDay() === 3)))
    return "remembrance";
  if (month === 11 && day === 11) return "martin";
  if (month === 12 && day >= 5 && day <= 6) return "nicholas";
  if (month === 12 && day >= 24 && day <= 26) return "christmas";
  const sinceEaster = calendarDay(date) - calendarDay(easterSunday(date.getFullYear()));
  if (sinceEaster >= -50 && sinceEaster <= -47) return "carnival";
  if (sinceEaster >= -7 && sinceEaster <= 1) return "easter";
  if (sinceEaster === 39) return "fathers-day";
  if (sinceEaster === 49 || sinceEaster === 50) return "pentecost";
  if (sinceEaster === 60) return "corpus-christi";
  if (month === 5 && day >= 8 && day <= 14 && date.getDay() === 0) return "mothers-day";
  const christmas = new Date(date.getFullYear(), 11, 25);
  const firstAdvent = calendarDay(christmas) - (christmas.getDay() || 7) - 21;
  if (calendarDay(date) >= firstAdvent && (month === 11 || (month === 12 && day <= 23)))
    return "advent";
  return null;
}
