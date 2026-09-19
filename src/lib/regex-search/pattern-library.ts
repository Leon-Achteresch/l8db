import type { RegexPatternTemplate } from "./types";

export const REGEX_PATTERN_LIBRARY: RegexPatternTemplate[] = [
  {
    id: "digits",
    label: "Ziffernfolge",
    pattern: "\\d+",
    description: "Eine oder mehrere Ziffern",
  },
  {
    id: "decimal",
    label: "Dezimalzahl",
    pattern: "-?\\d+(?:[.,]\\d+)?",
    description: "Zahl mit optionalem Vorzeichen und Nachkommastellen",
  },
  {
    id: "word",
    label: "Wort",
    pattern: "\\w+",
    description: "Buchstaben, Ziffern oder Unterstrich",
  },
  {
    id: "whole-word",
    label: "Ganzes Wort",
    pattern: "\\bWORT\\b",
    description: "Treffer nur an Wortgrenzen",
  },
  {
    id: "line-start",
    label: "Zeilenanfang",
    pattern: "^",
    description: "Verankert am Zeilenanfang",
  },
  {
    id: "line-end",
    label: "Zeilenende",
    pattern: "$",
    description: "Verankert am Zeilenende",
  },
  {
    id: "trailing-space",
    label: "Leerzeichen am Zeilenende",
    pattern: "[ \\t]+$",
    description: "Überflüssige Leerzeichen vor dem Zeilenumbruch",
  },
  {
    id: "quoted",
    label: "Zeichenkette in Hochkommas",
    pattern: "'(?:[^']|'')*'",
    description: "SQL-Literal inklusive verdoppelter Hochkommas",
  },
  {
    id: "sql-comment",
    label: "SQL-Kommentar",
    pattern: "--.*$",
    description: "Zeilenkommentar bis zum Zeilenende",
  },
  {
    id: "email",
    label: "E-Mail",
    pattern: "[\\w.%+-]+@[\\w.-]+\\.[A-Za-z]{2,}",
    description: "Einfache E-Mail-Adresse",
  },
  {
    id: "uuid",
    label: "UUID",
    pattern: "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}",
    description: "UUID im Standardformat",
  },
  {
    id: "iso-date",
    label: "Datum ISO",
    pattern: "\\d{4}-\\d{2}-\\d{2}",
    description: "Datum im Format JJJJ-MM-TT",
  },
  {
    id: "alternative",
    label: "Alternative",
    pattern: "(?:A|B)",
    description: "Entweder A oder B",
  },
  {
    id: "optional-group",
    label: "Optionale Gruppe",
    pattern: "(?:TEXT)?",
    description: "Teil darf fehlen",
  },
  {
    id: "any-chars",
    label: "Beliebige Zeichen",
    pattern: ".*?",
    description: "Möglichst kurze Zeichenfolge",
  },
];
