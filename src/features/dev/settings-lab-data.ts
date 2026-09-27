import { Blocks, CodeXml, Database, Info, Keyboard, ShieldCheck, Sliders } from "lucide-react";

export const settingsLabCategories = [
  {
    id: "general",
    label: "Allgemein",
    description: "Oberfläche und Arbeitsweise",
    icon: Sliders,
    options: [
      {
        id: "easy",
        label: "Easy Mode",
        description: "Weniger Werkzeuge in der Navigation anzeigen.",
        kind: "toggle",
      },
      {
        id: "theme",
        label: "Erscheinungsbild",
        description: "Farbschema der Anwendung.",
        kind: "choice",
        choices: ["System", "Hell", "Dunkel"],
      },
      {
        id: "density",
        label: "Darstellungsdichte",
        description: "Abstände in Tabellen und Listen.",
        kind: "choice",
        choices: ["Komfortabel", "Kompakt"],
      },
      {
        id: "operators",
        label: "Filteroperatoren übersetzen",
        description: "Verständliche Bezeichnungen im Filtermenü.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "editor",
    label: "SQL-Editor",
    description: "Schrift und Eingabe",
    icon: CodeXml,
    options: [
      {
        id: "minimap",
        label: "Minimap anzeigen",
        description: "Übersicht am Rand des Editors.",
        kind: "toggle",
      },
      {
        id: "wrap",
        label: "Zeilen umbrechen",
        description: "Lange SQL-Zeilen im Editor umbrechen.",
        kind: "toggle",
      },
      {
        id: "font",
        label: "Schriftgröße",
        description: "Textgröße für SQL-Abfragen.",
        kind: "choice",
        choices: ["12 px", "14 px", "16 px"],
      },
      {
        id: "keymap",
        label: "Tastenbelegung",
        description: "Vertraute Kürzel beim Schreiben.",
        kind: "choice",
        choices: ["Standard", "Vim"],
      },
    ],
  },
  {
    id: "data",
    label: "Daten & Abfragen",
    description: "Limits und Transaktionen",
    icon: Database,
    options: [
      {
        id: "limit",
        label: "Standard-Zeilenlimit",
        description: "Datensätze pro Tabellenaufruf.",
        kind: "choice",
        choices: ["50", "100", "500"],
      },
      {
        id: "timeout",
        label: "Query-Timeout",
        description: "Maximale Laufzeit einer Abfrage.",
        kind: "choice",
        choices: ["30 s", "60 s", "120 s"],
      },
      {
        id: "safe",
        label: "Safe Mode",
        description: "Änderungen erst nach manuellem Commit speichern.",
        kind: "toggle",
      },
      {
        id: "confirm",
        label: "Löschabfragen bestätigen",
        description: "Vor destruktiven Statements nachfragen.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "security",
    label: "Sicherheit & SSH",
    description: "Schlüssel und Netzwerk",
    icon: ShieldCheck,
    options: [
      {
        id: "hostkey",
        label: "Hostschlüssel prüfen",
        description: "SSH-Server bei der Verbindung verifizieren.",
        kind: "toggle",
      },
      {
        id: "keychain",
        label: "Schlüsselbund verwenden",
        description: "Zugangsdaten sicher im Betriebssystem speichern.",
        kind: "toggle",
      },
      {
        id: "sshagent",
        label: "SSH-Agent",
        description: "Vorhandene Identitäten für Tunnel nutzen.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "extensions",
    label: "Erweiterungen",
    description: "Plugins verwalten",
    icon: Blocks,
    options: [
      {
        id: "plugins",
        label: "Erweiterungen aktivieren",
        description: "Installierte Erweiterungen in der App anzeigen.",
        kind: "toggle",
      },
      {
        id: "updates",
        label: "Automatisch prüfen",
        description: "Nach neuen Versionen für Erweiterungen suchen.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "hotkeys",
    label: "Tastenkürzel",
    description: "Schneller arbeiten",
    icon: Keyboard,
    options: [
      {
        id: "shortcuts",
        label: "Globale Kürzel",
        description: "Navigation über die Tastatur verwenden.",
        kind: "toggle",
      },
      {
        id: "keyhints",
        label: "Kürzel anzeigen",
        description: "Hinweise in Menüs und Tooltips einblenden.",
        kind: "toggle",
      },
    ],
  },
  {
    id: "about",
    label: "Über & Updates",
    description: "Version und Diagnose",
    icon: Info,
    options: [
      {
        id: "autoupdate",
        label: "Nach Updates suchen",
        description: "Neue App-Versionen regelmäßig prüfen.",
        kind: "toggle",
      },
      {
        id: "diagnostics",
        label: "Diagnosehinweise",
        description: "Technische Informationen bei Fehlern anzeigen.",
        kind: "toggle",
      },
    ],
  },
] as const;

export type SettingsLabCategory = (typeof settingsLabCategories)[number];
export type SettingsLabValues = Record<string, string | boolean>;
export interface SettingsLabVariantProps {
  category: SettingsLabCategory;
  onCategoryChange: (id: SettingsLabCategory["id"]) => void;
  values: SettingsLabValues;
  onValueChange: (id: string, value: string | boolean) => void;
}
