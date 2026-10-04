import {
  ArchiveRestoreIcon,
  ArrowRightLeftIcon,
  BellIcon,
  BellRingIcon,
  DatabaseBackupIcon,
  DatabaseZapIcon,
  EraserIcon,
  FileArchiveIcon,
  FileInputIcon,
  FileOutputIcon,
  FileSearchIcon,
  FilesIcon,
  FolderInputIcon,
  FolderPlusIcon,
  GitCompareArrowsIcon,
  GlobeIcon,
  HourglassIcon,
  type LucideIcon,
  OctagonXIcon,
  PackageOpenIcon,
  RepeatIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
  SplitIcon,
  SquareTerminalIcon,
  TableIcon,
  Trash2Icon,
  VariableIcon,
  WandSparklesIcon,
  WorkflowIcon,
} from "lucide-react";
import type { ActionType } from "@/lib/db/automation";

export type StepGroup = "Datenbank" | "Daten" | "Dateien" | "Ablauf" | "Kommunikation";

export interface StepCatalogEntry {
  label: string;
  description: string;
  group: StepGroup;
  icon: LucideIcon;
  risky: boolean;
}

export const STEP_GROUPS: StepGroup[] = [
  "Datenbank",
  "Daten",
  "Dateien",
  "Ablauf",
  "Kommunikation",
];

export const STEP_GROUP_TONE: Record<StepGroup, string> = {
  Datenbank: "bg-sky-500/12 text-sky-600 dark:text-sky-400",
  Daten: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400",
  Dateien: "bg-amber-500/14 text-amber-700 dark:text-amber-400",
  Ablauf: "bg-violet-500/12 text-violet-600 dark:text-violet-400",
  Kommunikation: "bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400",
};

export const STEP_CATALOG: Record<ActionType, StepCatalogEntry> = {
  sql: {
    label: "SQL ausführen",
    description: "Skript auf einer oder mehreren Verbindungen ausführen",
    group: "Datenbank",
    icon: DatabaseZapIcon,
    risky: false,
  },
  backup: {
    label: "Backup",
    description: "Datenbank in eine Datei sichern",
    group: "Datenbank",
    icon: DatabaseBackupIcon,
    risky: false,
  },
  restore: {
    label: "Wiederherstellen",
    description: "Backup-Datei in eine Datenbank einspielen",
    group: "Datenbank",
    icon: ArchiveRestoreIcon,
    risky: true,
  },
  datagen: {
    label: "Testdaten erzeugen",
    description: "Tabelle mit realistischen Zufallsdaten füllen",
    group: "Datenbank",
    icon: WandSparklesIcon,
    risky: true,
  },
  export: {
    label: "Exportieren",
    description: "Abfrage oder Tabelle als CSV, XLSX, JSON … speichern",
    group: "Daten",
    icon: FileOutputIcon,
    risky: false,
  },
  import: {
    label: "Importieren",
    description: "CSV-, JSON-, XLSX- oder Parquet-Datei in eine Tabelle laden",
    group: "Daten",
    icon: FileInputIcon,
    risky: false,
  },
  table_copy: {
    label: "Tabellen kopieren",
    description: "Tabellen in eine andere Verbindung spiegeln",
    group: "Daten",
    icon: TableIcon,
    risky: false,
  },
  transfer: {
    label: "Schema übertragen",
    description: "Schemas mit Struktur und Daten in ein leeres Ziel kopieren",
    group: "Daten",
    icon: ArrowRightLeftIcon,
    risky: false,
  },
  compare: {
    label: "Daten vergleichen",
    description: "Zwei Tabellen zeilenweise vergleichen und berichten",
    group: "Daten",
    icon: GitCompareArrowsIcon,
    risky: false,
  },
  check: {
    label: "Daten prüfen",
    description: "Zeilenzahl, Eindeutigkeit, Aktualität und mehr sicherstellen",
    group: "Daten",
    icon: ShieldCheckIcon,
    risky: false,
  },
  alert: {
    label: "Abfrage-Alarm",
    description: "Bei auffälligen Abfrageergebnissen benachrichtigen",
    group: "Daten",
    icon: BellRingIcon,
    risky: false,
  },
  file_copy: {
    label: "Datei kopieren",
    description: "Dateien kopieren, auch mit * und ?",
    group: "Dateien",
    icon: FilesIcon,
    risky: false,
  },
  file_move: {
    label: "Datei verschieben",
    description: "Dateien verschieben oder umbenennen",
    group: "Dateien",
    icon: FolderInputIcon,
    risky: true,
  },
  file_delete: {
    label: "Dateien löschen",
    description: "Dateien nach Muster löschen",
    group: "Dateien",
    icon: Trash2Icon,
    risky: true,
  },
  mkdir: {
    label: "Ordner anlegen",
    description: "Ordner samt fehlender Elternordner anlegen",
    group: "Dateien",
    icon: FolderPlusIcon,
    risky: false,
  },
  file_exists: {
    label: "Datei vorhanden?",
    description: "Prüfen, ob eine Datei existiert",
    group: "Dateien",
    icon: FileSearchIcon,
    risky: false,
  },
  zip: {
    label: "ZIP erstellen",
    description: "Dateien in ein ZIP-Archiv packen",
    group: "Dateien",
    icon: FileArchiveIcon,
    risky: false,
  },
  unzip: {
    label: "ZIP entpacken",
    description: "ZIP-Archiv in einen Ordner entpacken",
    group: "Dateien",
    icon: PackageOpenIcon,
    risky: true,
  },
  cleanup: {
    label: "Alte Dateien aufräumen",
    description: "Ältere Dateien löschen oder nur die neuesten behalten",
    group: "Dateien",
    icon: EraserIcon,
    risky: true,
  },
  condition: {
    label: "Bedingung",
    description: "Je nach Vergleich zu einem anderen Schritt springen",
    group: "Ablauf",
    icon: SplitIcon,
    risky: false,
  },
  loop: {
    label: "Schleife",
    description: "Schritte für Zeilen, Verbindungen, Werte oder Dateien wiederholen",
    group: "Ablauf",
    icon: RepeatIcon,
    risky: false,
  },
  wait: {
    label: "Warten",
    description: "Eine Weile oder bis zu einer Uhrzeit pausieren",
    group: "Ablauf",
    icon: HourglassIcon,
    risky: false,
  },
  set_variable: {
    label: "Variable setzen",
    description: "Wert berechnen oder aus einer Abfrage übernehmen",
    group: "Ablauf",
    icon: VariableIcon,
    risky: false,
  },
  run_task: {
    label: "Task starten",
    description: "Einen anderen Task ausführen",
    group: "Ablauf",
    icon: WorkflowIcon,
    risky: false,
  },
  log: {
    label: "Log-Eintrag",
    description: "Eine Zeile ins Lauf-Log schreiben",
    group: "Ablauf",
    icon: ScrollTextIcon,
    risky: false,
  },
  fail: {
    label: "Mit Fehler abbrechen",
    description: "Lauf mit einer eigenen Meldung beenden",
    group: "Ablauf",
    icon: OctagonXIcon,
    risky: false,
  },
  notify: {
    label: "Benachrichtigen",
    description: "System, E-Mail, Slack, Teams, Discord oder Webhook",
    group: "Kommunikation",
    icon: BellIcon,
    risky: false,
  },
  http: {
    label: "HTTP-Anfrage",
    description: "Eine URL aufrufen, z. B. einen Webhook",
    group: "Kommunikation",
    icon: GlobeIcon,
    risky: true,
  },
  shell: {
    label: "Programm ausführen",
    description: "Ein lokales Programm mit Argumenten starten",
    group: "Kommunikation",
    icon: SquareTerminalIcon,
    risky: true,
  },
};

export const ACTION_TYPES = Object.keys(STEP_CATALOG) as ActionType[];
