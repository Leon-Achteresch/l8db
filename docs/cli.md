# Kommandozeile (`l8db`)

Das App-Binary ist zugleich die CLI. Ohne Argumente (oder mit Dateipfaden, `--file`, `--new-window`, `--menu=…`) startet die App; ein bekannter Befehl, eine globale Option (`-c`, `--url`, `-o`, `-d`) oder ein unbekanntes Wort ohne Pfadzeichen startet die CLI (`src-tauri/src/cli/mod.rs`, `wants`).

## Befehle

Aufbau nach dem Muster von `gh`/`kubectl`: `l8db <nomen> <verb>`, kurze Aliase für die häufigsten Befehle.

| Befehl | Zweck |
|---|---|
| `conn list` / `use` / `test` / `show` | Gespeicherte Verbindungen; `use` setzt den Standard (`cli.json`), ohne Namen über die Auswahl im Terminal |
| `tui` | Interaktiver Modus im Terminal: Verbindung wählen, Tabellen blättern, SQL ausführen (siehe unten) |
| `query [SQL]` (`q`) | SQL als Argument, `-f datei`, `-` oder Standardeingabe |
| `db list`, `schema list` | Datenbanken, Schemas |
| `table list` / `describe` / `rows` / `count` | Tabellen und Views; Name oder `schema.name`, Groß-/Kleinschreibung egal, Namen mit Punkt in Anführungszeichen (`'"a.b"'`) |
| `open [name]` | Verbindung in der App öffnen (`--menu=dock.connection:<id>`) |
| `task list` / `run`, `check`, `mcp` | Bestehende Modi `--run-task`, `--check`, `--mcp` unter neuen Namen; die alten Flags bleiben |
| `doctor [--test-keychain] [--strict]` | Arbeitsplatz, IT-Richtlinie und Team-Datei ohne Zugangsdaten prüfen |
| `policy templates <pfad>` | Gruppenrichtlinienvorlagen für Windows (`l8db.admx`, `de-DE`/`en-US`) schreiben |
| `completions <shell>` | bash, zsh, fish, PowerShell |
| `version` (`--version`, `-V`, `-v`) | Version ausgeben |

Globale Optionen: `-c/--connection`, `--url`, `-d/--database`, `-o/--output table|json|ndjson|csv|tsv`. Ohne `-o` gibt die CLI im Terminal eine Tabelle aus, in Pipes TSV. Passt die Tabelle nicht in die Terminalbreite, erscheint jede Zeile als Datensatz („Zeile 1“, darunter je Spalte `NAME  wert`), statt Spalten auf wenige Zeichen umzubrechen. NULL ist in TSV `\N`, in CSV ein leeres Feld; ein Leerstring steht in CSV als `""`. `--url http(s)://…` ist mehrdeutig, dafür `clickhouse://`, `elasticsearch://` oder `influxdb://` nutzen; `--timeout` braucht mindestens 5 Sekunden (0 = ohne Grenze). Ergebnisse gehen nach stdout, Status und Hinweise nach stderr. Exit-Codes: 0 ok, 1 Fehler, 2 falscher Aufruf, 130 mit Strg+C abgebrochen (der Treiber bricht die Abfrage auf dem Server ab, wo er das kann: Postgres, SQLite).

Hilfe, Fehlermeldungen und Vorschläge („Meintest du …?“) sind deutsch; `localize` setzt Überschriften und Standardwerte für alle Befehle, `german` übersetzt clap-Fehler. `every_documented_example_parses` prüft jedes Beispiel aus den Hilfetexten.

## Verbindungen

Die CLI legt keine Verbindungen an. Sie nutzt die Spiegelung der Automatisierung (`automation.db`, `src/lib/automation/sync.ts`), die die App bei jeder Änderung schreibt: ohne Passwörter, mit SSH-, Proxy- und Befehls-Tunnel sowie Umgebung und Schreibschutz. `automation::connection::resolve` holt Passwörter aus dem Schlüsselbund, öffnet Tunnel und fällt nie auf eine direkte Verbindung zurück. Verbindungen aus dem Passwortmanager (`vault`) und S3 lehnt sie mit Begründung ab.

Auswahl: `-c` → `--url`/`$L8DB_URL` → `$L8DB_CONNECTION` → Standard aus `conn use` → einzige Verbindung → in der App geöffnete Verbindung → Auswahl im Terminal → Fehler mit Liste. Die App schreibt die zuletzt aktivierte Verbindung nach `cli-active` (neben `cli.json`, `WindowConnections::publish`) und hält dabei eine Dateisperre auf `cli-active.lock`; die CLI wertet die Datei nur aus, solange die Sperre gehalten wird, ein Rest nach einem Absturz zählt also nicht. Sie meldet die Wahl auf stderr („Verbindung: … (in der App geöffnet)“). Sind stdin und stderr ein Terminal, fragt sonst eine filterbare Liste auf stderr (`tui::pick`, dieselbe iocraft-Komponente `ConnectionPicker` wie im interaktiven Modus: tippen filtert, Enter wählt, Esc bricht ab, Strg+C endet mit 130); in Pipes und CI bleibt es beim Fehler.

## Interaktiver Modus (`l8db tui`)

`src-tauri/src/cli/tui/`, gebaut mit `iocraft` (React-artige Komponenten und Hooks, Terminalzugriff über `crossterm`). Startet nur, wenn stdin und stdout ein Terminal sind; sonst Fehler mit Exit-Code 1. `-c`, `--url`, `$L8DB_URL` und `$L8DB_CONNECTION` öffnen die Verbindung direkt, sonst beginnt die Verbindungsauswahl mit dem Standard aus `conn use` bzw. der in der App geöffneten Verbindung als Vorauswahl.

| Bildschirm | Tasten |
|---|---|
| Verbindungen | Tippen filtert, ↑↓, Enter öffnet, Esc beendet |
| Tabellen | ↑↓ Bild↑↓, Enter Zeilen, `d` Spalten, `s` SQL, `/` Filter, Esc zurück, `q` beendet |
| Zeilen / Spalten | ↑↓ ←→ Bild↑↓ Pos1 Ende blättern, `m` lädt die nächsten 100 Zeilen (höchstens 1000), `d` Spalten, `s` SQL, Esc zurück, `q` beendet |
| SQL | mehrzeiliger Editor, Strg+R (auch F5, F9) führt aus, Tab wechselt zwischen Editor und Ergebnis, Esc zurück |

Strg+C bricht eine laufende Anfrage ab und beendet sonst das Programm. Postgres und SQLite bestätigen den Abbruch (`execution::cancel`); bei allen anderen Treibern, oder nach einem zweiten Strg+C, verwirft die TUI die Anfrage lokal, sagt, dass die Datenbank die Anweisung möglicherweise noch zu Ende führt, und baut die Verbindung für die nächste Anfrage neu auf. Strg+C wird im Raw-Modus als Taste gelesen, der Starter `l8db.cmd` fragt deshalb nicht nach dem Batchabbruch. Enter fügt im Editor eine Zeile ein, damit eingefügtes mehrzeiliges SQL nie vorzeitig läuft.

Aufbau: `model.rs` ist ein reiner Zustandsautomat (`Model::key` liefert höchstens einen `Effect`, `Model::apply` verarbeitet die Antwort), `grid.rs` schneidet das sichtbare Fenster aus den Zellen, `backend.rs` führt Anfragen als Tokio-Task aus, `app.rs`/`picker.rs`/`prompt.rs` sind die iocraft-Komponenten. Während eine Anfrage läuft, nimmt das Modell nur Strg+C an; Blättern liest ausschließlich bereits geladene Zellen und löst nie eine Datenbankabfrage aus. Es gibt keine Timer: ohne Tastendruck rendert und fragt die TUI nichts.

Schutz: SQL läuft über dieselbe Strecke wie `query` (`run::prepare` → `run::run_prepared`), also mit Schreibschutz, Produktionsbestätigung (Verbindungsname eintippen, geprüft in `allow_write`), 1000-Zeilen-Limit, 300 s Timeout und Transaktion mit Rollback bei mehreren schreibenden Anweisungen. Zeilen kommen wie bei `table rows` über `fetch_rows` in Seiten zu 100. Zellen werden auf 80 Zeichen gekürzt und von Steuerzeichen befreit, damit Daten keine Terminal-Sequenzen auslösen. Der Terminalzustand (Raw-Modus, alternativer Bildschirm, Cursor) wird beim Beenden, bei Fehlern und bei Panics zurückgesetzt (`terminal::guard`, `Drop` des iocraft-Backends). Lässt sich das Terminal nicht in den Raw-Modus schalten (kein `CONIN$` unter Windows), endet der Befehl mit einer Fehlermeldung statt zu hängen.

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
- `l8db tui`: Maus wird nicht ausgewertet (Textauswahl des Terminals bleibt nutzbar), keine Sortierung, kein Filter auf Zeilen, keine Bearbeitung von Zellen. Unter Windows nur typgeprüft, nicht ausgeführt: `crossterm` liest Tasten über `CONIN$`, geschrieben wird auf die Standard-Handles; ohne den Starter `l8db.cmd` lesen Shell und TUI gleichzeitig die Tastatur.
- Windows: `l8db.exe` ist ein GUI-Binary, auf das cmd und PowerShell nicht warten; direkt aufgerufen kehrt die Eingabeaufforderung vor der Ausgabe zurück und der Befehl wirkt, als ende er nie. Im `PATH` steht deshalb zuerst `<Programmordner>\bin` mit dem Starter `l8db.cmd` (`src-tauri/windows/l8db.cmd`, als Ressource im Bundle), der auf das Ende wartet und den Exit-Code durchreicht. `AttachConsole` ersetzt die Standardkanäle eines von cmd gestarteten GUI-Programms durch die Konsole, auch wenn sie umgeleitet sind; `attach_console` merkt sich deshalb vorher Dateien, Pipes und `NUL` und setzt genau diese danach wieder ein. Ohne das gingen `> datei`, Pipes und `$x = l8db …` leer aus und SQL über die Standardeingabe blieb hängen. Strg+C fragt über den Starter danach „Batchvorgang abbrechen (J/N)?“. Belegt auf `windows-2025` durch den Workflow „Windows CLI“; die Verbindungsauswahl per Tastatur und der Installer selbst sind dort nicht abgedeckt.

## In der App

Einstellungen → Kommandozeile: „Zum PATH hinzufügen“ legt `/usr/local/bin/l8db` an (macOS, bei Bedarf mit Administratorabfrage), `~/.local/bin/l8db` unter Linux (AppImage: Pfad aus `$APPIMAGE`; fehlt der Ordner im `PATH`, kommt eine mit `# added by l8db` markierte Zeile in die Startdatei der Shell) oder trägt `<Programmordner>\bin` und dahinter den Programmordner in den Benutzer-`PATH` ein (Windows, Registry-Typ und `%VARIABLEN%` bleiben erhalten; Shells finden so `l8db.cmd`, Programme wie MCP-Clients weiter `l8db.exe`; fehlt der Starter, legt die App ihn an). Die App prüft danach und einmal je Start, welches `l8db` ein neues Terminal findet: `ready`, `missing`, `not_on_path` oder `other` (ein fremdes `l8db` liegt weiter vorn). Unter Windows gilt ein `PATH`, in dem `l8db.exe` vor dem Starter gefunden wird (Eintrag aus 0.18.0-canary.5), als `missing`; steht der Programmordner im Benutzer-`PATH`, ordnet die Prüfung beim Start ihn von selbst um (`repaired`), sonst der Klick auf „Zum PATH hinzufügen“. Bei `missing` und `not_on_path` zeigen das Zahnrad und die Kategorie „Kommandozeile“ einen blauen Punkt, bis der Befehl erreichbar ist. Darunter ein kopierbarer Spickzettel und die Einrichtung der Tab-Vervollständigung.

## Tests

- `.github/workflows/windows-cli.yml` (Push auf `development`, wenn sich `src-tauri/src/cli/**`, `src-tauri/windows/**` oder der Lauf selbst ändern): baut das Binary auf `windows-2025` und prüft mit `scripts/test-windows-cli.ps1` Starter, Exit-Codes, Umleitung in Datei und Pipe, SQL über die Standardeingabe, die Reihenfolge von Ausgabe und Prompt (in cmd getippt und in einer echten Konsole) und die `PATH`-Auflösung; dazu die CLI-Tests und der ignorierte Test `the_user_path_survives_install_repair_and_uninstall` gegen die echte Registry (nur dort ausführen, er ändert den Benutzer-`PATH`).
- `cargo test cli::` und `cargo test automation::connection` (Parser, Routing, Fehlermeldungen, Beispiele, Schreib-Erkennung, Befehls-Tunnel).
- `cargo test --lib cli::tui -- --nocapture`: Zustandsautomat, Raster und die Performance-Fälle `perf_*` (Scrollen eines 1000×60-Ergebnisses, Kontrollraster mit 100 000 Zeilen, Objektliste mit 20 000 Tabellen, gerenderte iocraft-Bilder über das Mock-Terminal); die gemessenen Werte stehen in `docs/performance.md` unter „Terminal mode“.
- `L8DB_CLI_E2E=1 bun test tests/cli-e2e.test.ts` mit gebautem Debug-Binary: SQLite-Datei, gespeicherte Verbindungen in einer temporären `automation.db`, TTY über Python-`pty` (`tty` für einmalige Eingaben, `screen` wartet je Schritt auf einen Text und tippt dann; so laufen die TUI-Fälle für Auswahl, Blättern, SQL, Schutzregeln und Abbruch). Mit `L8DB_CLI_E2E_PG=postgres://…` zusätzlich Postgres (Rollback, Ctrl+C), mit `L8DB_CLI_E2E_PG_PERF=postgres://…/l8db_perf` die Performance-Messung auf der 2-Mio.-Zeilen-Tabelle `big`.

Unternehmensrichtlinien und vollständige CLI-Abnahme: [enterprise-rollout.md](enterprise-rollout.md).
