# Kommandozeile (`l8db`)

Das App-Binary ist zugleich die CLI. Ohne Argumente (oder mit Dateipfaden, `--file`, `--new-window`, `--menu=…`) startet die App; ein bekannter Befehl, eine globale Option (`-c`, `--url`, `-o`, `-d`) oder ein unbekanntes Wort ohne Pfadzeichen startet die CLI (`src-tauri/src/cli/mod.rs`, `wants`).

## Befehle

Aufbau nach dem Muster von `gh`/`kubectl`: `l8db <nomen> <verb>`, kurze Aliase für die häufigsten Befehle.

| Befehl | Zweck |
|---|---|
| `conn list` / `use` / `test` / `show` | Gespeicherte Verbindungen; `use` setzt den Standard (`cli.json`) |
| `query [SQL]` (`q`) | SQL als Argument, `-f datei`, `-` oder Standardeingabe |
| `db list`, `schema list` | Datenbanken, Schemas |
| `table list` / `describe` / `rows` / `count` | Tabellen und Views; Name oder `schema.name`, Groß-/Kleinschreibung egal, Namen mit Punkt in Anführungszeichen (`'"a.b"'`) |
| `open [name]` | Verbindung in der App öffnen (`--menu=dock.connection:<id>`) |
| `task list` / `run`, `check`, `mcp` | Bestehende Modi `--run-task`, `--check`, `--mcp` unter neuen Namen; die alten Flags bleiben |
| `doctor [--test-keychain] [--strict]` | Arbeitsplatz, IT-Richtlinie und Team-Datei ohne Zugangsdaten prüfen |
| `policy templates <pfad>` | Gruppenrichtlinienvorlagen für Windows (`l8db.admx`, `de-DE`/`en-US`) schreiben |
| `completions <shell>` | bash, zsh, fish, PowerShell |
| `version` (`--version`, `-V`, `-v`) | Version ausgeben |

Globale Optionen: `-c/--connection`, `--url`, `-d/--database`, `-o/--output table|json|ndjson|csv|tsv`. Ohne `-o` gibt die CLI im Terminal eine Tabelle aus, in Pipes TSV. NULL ist in TSV `\N`, in CSV ein leeres Feld; ein Leerstring steht in CSV als `""`. `--url http(s)://…` ist mehrdeutig, dafür `clickhouse://`, `elasticsearch://` oder `influxdb://` nutzen; `--timeout` braucht mindestens 5 Sekunden (0 = ohne Grenze). Ergebnisse gehen nach stdout, Status und Hinweise nach stderr. Exit-Codes: 0 ok, 1 Fehler, 2 falscher Aufruf, 130 mit Strg+C abgebrochen (der Treiber bricht die Abfrage auf dem Server ab, wo er das kann: Postgres, SQLite).

Hilfe, Fehlermeldungen und Vorschläge („Meintest du …?“) sind deutsch; `localize` setzt Überschriften und Standardwerte für alle Befehle, `german` übersetzt clap-Fehler. `every_documented_example_parses` prüft jedes Beispiel aus den Hilfetexten.

## Verbindungen

Die CLI legt keine Verbindungen an. Sie nutzt die Spiegelung der Automatisierung (`automation.db`, `src/lib/automation/sync.ts`), die die App bei jeder Änderung schreibt: ohne Passwörter, mit SSH-, Proxy- und Befehls-Tunnel sowie Umgebung und Schreibschutz. `automation::connection::resolve` holt Passwörter aus dem Schlüsselbund, öffnet Tunnel und fällt nie auf eine direkte Verbindung zurück. Verbindungen aus dem Passwortmanager (`vault`) und S3 lehnt sie mit Begründung ab.

Auswahl: `-c` → `--url`/`$L8DB_URL` → `$L8DB_CONNECTION` → Standard aus `conn use` → einzige Verbindung → in der App geöffnete Verbindung → Auswahl im Terminal → Fehler mit Liste. Die App schreibt die zuletzt aktivierte Verbindung nach `cli-active` (neben `cli.json`, `WindowConnections::publish`) und hält dabei eine Dateisperre auf `cli-active.lock`; die CLI wertet die Datei nur aus, solange die Sperre gehalten wird, ein Rest nach einem Absturz zählt also nicht. Sie meldet die Wahl auf stderr („Verbindung: … (in der App geöffnet)“). Sind stdin und stderr ein Terminal, fragt sonst eine filterbare Liste (`dialoguer::FuzzySelect`: tippen filtert, Enter wählt, Esc bricht ab); in Pipes und CI bleibt es beim Fehler.

## Sicherheit

- Schreibgeschützte Verbindungen (auch Produktion mit „Produktion schreibgeschützt öffnen“) lehnen schreibendes SQL ab, bevor eine Verbindung aufgebaut wird; Postgres erzwingt das zusätzlich serverseitig.
- Schreibendes SQL auf Produktion verlangt im Terminal das Eintippen des Verbindungsnamens, sonst `--yes`.
- Postgres liest Einzelabfragen mit Limit in einer Read-only-Transaktion; schreibt eine Funktion darin, gelten dieselben Schutzregeln und die Abfrage läuft danach normal mit Commit.
- `table rows/count --where` nimmt nur eine Bedingung an (kein `;`, `--`, `/* */`, `#` außer bei Postgres, `UNION`, `INTO`, `RETURNING`, keine schreibenden Schlüsselwörter, Klammern ausgeglichen) und wird geklammert eingesetzt, wie der einfache Filter in der App. MongoDB erwartet JSON (`'{"status":"open"}'`), Redis ein Key-Muster (`'user:*'`). Eigenes SQL gehört in `l8db q`.
- Mehrere Anweisungen mit Schreibzugriff laufen in einer Transaktion (Postgres, Oracle u. a.); beim ersten Fehler wird zurückgerollt. MySQL und Oracle schreiben DDL sofort fest; die Fehlermeldung sagt dann, dass solche Anweisungen bestehen bleiben. `--no-transaction` schaltet das ab (z. B. für `CREATE INDEX CONCURRENTLY`).
- `conn list/show` zeigen Adressen ohne Passwort.

## Grenzen

- Standardmäßig höchstens 1000 Zeilen pro Ergebnis (`-n`, `--all`); Postgres, MySQL, SQLite und DuckDB holen dann auch nur so viele Zeilen. Mit `--all` liegt das ganze Ergebnis im Speicher.
- Ausgabe ohne Datenmaskierung und ohne Pager.
- Windows: `l8db.exe` ist ein GUI-Binary, auf das cmd und PowerShell nicht warten; direkt aufgerufen kehrt die Eingabeaufforderung vor der Ausgabe zurück und der Befehl wirkt, als ende er nie. Im `PATH` steht deshalb zuerst `<Programmordner>\bin` mit dem Starter `l8db.cmd` (`src-tauri/windows/l8db.cmd`, als Ressource im Bundle), der auf das Ende wartet und den Exit-Code durchreicht; das Binary hängt sich per `AttachConsole` an dessen Konsole. Strg+C fragt danach „Batchvorgang abbrechen (J/N)?“. Auf echtem Windows ungetestet.

## In der App

Einstellungen → Kommandozeile: „Zum PATH hinzufügen“ legt `/usr/local/bin/l8db` an (macOS, bei Bedarf mit Administratorabfrage), `~/.local/bin/l8db` unter Linux (AppImage: Pfad aus `$APPIMAGE`; fehlt der Ordner im `PATH`, kommt eine mit `# added by l8db` markierte Zeile in die Startdatei der Shell) oder trägt `<Programmordner>\bin` und dahinter den Programmordner in den Benutzer-`PATH` ein (Windows, Registry-Typ und `%VARIABLEN%` bleiben erhalten; Shells finden so `l8db.cmd`, Programme wie MCP-Clients weiter `l8db.exe`; fehlt der Starter, legt die App ihn an). Die App prüft danach und einmal je Start, welches `l8db` ein neues Terminal findet: `ready`, `missing`, `not_on_path` oder `other` (ein fremdes `l8db` liegt weiter vorn). Unter Windows gilt ein `PATH`, in dem `l8db.exe` vor dem Starter gefunden wird (Eintrag aus 0.18.0-canary.5), als `missing`; steht der Programmordner im Benutzer-`PATH`, ordnet die Prüfung beim Start ihn von selbst um (`repaired`), sonst der Klick auf „Zum PATH hinzufügen“. Bei `missing` und `not_on_path` zeigen das Zahnrad und die Kategorie „Kommandozeile“ einen blauen Punkt, bis der Befehl erreichbar ist. Darunter ein kopierbarer Spickzettel und die Einrichtung der Tab-Vervollständigung.

## Tests

- `cargo test cli::` und `cargo test automation::connection` (Parser, Routing, Fehlermeldungen, Beispiele, Schreib-Erkennung, Befehls-Tunnel).
- `L8DB_CLI_E2E=1 bun test tests/cli-e2e.test.ts` mit gebautem Debug-Binary: SQLite-Datei, gespeicherte Verbindungen in einer temporären `automation.db`, TTY über `script`. Mit `L8DB_CLI_E2E_PG=postgres://…` zusätzlich Postgres (Rollback, Ctrl+C), mit `L8DB_CLI_E2E_PG_PERF=postgres://…/l8db_perf` die Performance-Messung auf der 2-Mio.-Zeilen-Tabelle `big`.

Unternehmensrichtlinien und vollständige CLI-Abnahme: [enterprise-rollout.md](enterprise-rollout.md).
