# Kommandozeile (`l8db`)

Das App-Binary ist zugleich die CLI. Ohne Argumente (oder mit Dateipfaden, `--file`, `--new-window`, `--menu=…`) startet die App; ein bekannter Befehl, eine globale Option (`-c`, `--url`, `-o`, `-d`) oder ein unbekanntes Wort ohne Pfadzeichen startet die CLI (`src-tauri/src/cli/mod.rs`, `wants`).

## Befehle

Aufbau nach dem Muster von `gh`/`kubectl`: `l8db <nomen> <verb>`, kurze Aliase für die häufigsten Befehle.

| Befehl | Zweck |
|---|---|
| `conn list` / `use` / `test` / `show` | Gespeicherte Verbindungen; `use` setzt den Standard (`cli.json`) |
| `query [SQL]` (`q`) | SQL als Argument, `-f datei`, `-` oder Standardeingabe |
| `db list`, `schema list` | Datenbanken, Schemas |
| `table list` / `describe` / `rows` / `count` | Tabellen; Name oder `schema.name`, Groß-/Kleinschreibung egal |
| `open [name]` | Verbindung in der App öffnen (`--menu=dock.connection:<id>`) |
| `task list` / `run`, `check`, `mcp` | Bestehende Modi `--run-task`, `--check`, `--mcp` unter neuen Namen; die alten Flags bleiben |
| `completions <shell>` | bash, zsh, fish, PowerShell |

Globale Optionen: `-c/--connection`, `--url`, `-d/--database`, `-o/--output table|json|ndjson|csv|tsv`. Ohne `-o` gibt die CLI im Terminal eine Tabelle aus, in Pipes TSV. Ergebnisse gehen nach stdout, Status und Hinweise nach stderr. Exit-Codes: 0 ok, 1 Fehler, 2 falscher Aufruf, 130 mit Strg+C abgebrochen (der Treiber bricht die Abfrage auf dem Server ab, wo er das kann: Postgres, SQLite).

Hilfe, Fehlermeldungen und Vorschläge („Meintest du …?“) sind deutsch; `localize` setzt Überschriften und Standardwerte für alle Befehle, `german` übersetzt clap-Fehler. `every_documented_example_parses` prüft jedes Beispiel aus den Hilfetexten.

## Verbindungen

Die CLI legt keine Verbindungen an. Sie nutzt die Spiegelung der Automatisierung (`automation.db`, `src/lib/automation/sync.ts`), die die App bei jeder Änderung schreibt: ohne Passwörter, mit SSH-, Proxy- und Befehls-Tunnel sowie Umgebung und Schreibschutz. `automation::connection::resolve` holt Passwörter aus dem Schlüsselbund, öffnet Tunnel und fällt nie auf eine direkte Verbindung zurück. Verbindungen aus dem Passwortmanager (`vault`) und S3 lehnt sie mit Begründung ab.

Auswahl: `-c` → `--url`/`$L8DB_URL` → `$L8DB_CONNECTION` → Standard aus `conn use` → einzige Verbindung → Fehler mit Liste.

## Sicherheit

- Schreibgeschützte Verbindungen (auch Produktion mit „Produktion schreibgeschützt öffnen“) lehnen schreibendes SQL ab, bevor eine Verbindung aufgebaut wird; Postgres erzwingt das zusätzlich serverseitig.
- Schreibendes SQL auf Produktion verlangt im Terminal das Eintippen des Verbindungsnamens, sonst `--yes`.
- Mehrere Anweisungen mit Schreibzugriff laufen in einer Transaktion (Postgres, Oracle u. a.); beim ersten Fehler wird zurückgerollt. `--no-transaction` schaltet das ab (z. B. für `CREATE INDEX CONCURRENTLY`).
- `conn list/show` zeigen Adressen ohne Passwort.

## Grenzen

- Standardmäßig höchstens 1000 Zeilen pro Ergebnis (`-n`, `--all`); Postgres, MySQL, SQLite und DuckDB holen dann auch nur so viele Zeilen. Mit `--all` liegt das ganze Ergebnis im Speicher.
- Ausgabe ohne Datenmaskierung und ohne Pager.
- Windows: Das GUI-Binary hängt sich per `AttachConsole` an das aufrufende Terminal; die Eingabeaufforderung kann vor der Ausgabe zurückkehren. Auf echtem Windows ungetestet.

## In der App

Einstellungen → Kommandozeile: „Installieren“ legt `/usr/local/bin/l8db` an (macOS, bei Bedarf mit Administratorabfrage), `~/.local/bin/l8db` unter Linux (AppImage: Pfad aus `$APPIMAGE`) oder trägt den Programmordner in den Benutzer-`PATH` ein (Windows). Darunter ein kopierbarer Spickzettel und die Einrichtung der Tab-Vervollständigung.

## Tests

- `cargo test cli::` und `cargo test automation::connection` (Parser, Routing, Fehlermeldungen, Beispiele, Schreib-Erkennung, Befehls-Tunnel).
- `L8DB_CLI_E2E=1 bun test tests/cli-e2e.test.ts` mit gebautem Debug-Binary: SQLite-Datei, gespeicherte Verbindungen in einer temporären `automation.db`, TTY über `script`. Mit `L8DB_CLI_E2E_PG=postgres://…` zusätzlich Postgres (Rollback, Ctrl+C), mit `L8DB_CLI_E2E_PG_PERF=postgres://…/l8db_perf` die Performance-Messung auf der 2-Mio.-Zeilen-Tabelle `big`.
