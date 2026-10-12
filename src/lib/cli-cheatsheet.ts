export interface CliExample {
  command: string;
  description: string;
}

export interface CliExampleGroup {
  title: string;
  examples: CliExample[];
}

export const CLI_CHEATSHEET: CliExampleGroup[] = [
  {
    title: "Verbindungen",
    examples: [
      { command: "l8db conn list", description: "Gespeicherte Verbindungen anzeigen" },
      { command: "l8db conn use <name>", description: "Standardverbindung festlegen" },
      { command: "l8db conn test", description: "Verbindung prüfen" },
      { command: "l8db open <name>", description: "Verbindung in der App öffnen" },
    ],
  },
  {
    title: "Daten",
    examples: [
      { command: 'l8db q "select * from users limit 5"', description: "SQL ausführen" },
      { command: "l8db query -f skript.sql", description: "SQL-Datei ausführen" },
      { command: "l8db table list", description: "Tabellen auflisten" },
      { command: "l8db table describe users", description: "Spalten einer Tabelle" },
      {
        command: 'l8db table rows users --where "id > 10" -n 20',
        description: "Zeilen anzeigen",
      },
      { command: "l8db table count users", description: "Zeilen zählen" },
    ],
  },
  {
    title: "Ausgabe & Optionen",
    examples: [
      { command: "-c <name>", description: "Andere Verbindung für einen Befehl" },
      { command: "-o json | csv | tsv | ndjson", description: "Ausgabeformat wählen" },
      { command: "l8db q -o csv -f bericht.sql > bericht.csv", description: "Als CSV exportieren" },
      { command: "l8db --help", description: "Alle Befehle, l8db <befehl> --help für Details" },
    ],
  },
];

export const CLI_COMPLETIONS: CliExample[] = [
  {
    command: "l8db completions zsh > ~/.zfunc/_l8db",
    description: "zsh (fpath+=~/.zfunc in ~/.zshrc)",
  },
  {
    command: "l8db completions bash > ~/.local/share/bash-completion/completions/l8db",
    description: "bash",
  },
  {
    command: "l8db completions fish > ~/.config/fish/completions/l8db.fish",
    description: "fish",
  },
  { command: "l8db completions powershell >> $PROFILE", description: "PowerShell" },
];
