# Unternehmensrollout

Die Anwendung ist ein Datenbankclient. Datenbankrollen, Arbeitsplatzverwaltung und die betrieblichen Freigaben bleiben Aufgabe des Unternehmens. Ein grüner Testlauf ersetzt keine Abnahme mit den tatsächlich eingesetzten Servern, Rollen, Zertifikaten und Geräten.

## Verbindliche Maschinenrichtlinie

| Plattform | Datei |
| --- | --- |
| macOS | `/Library/Application Support/com.leon.l8db/policy.json` |
| Windows | `%PROGRAMDATA%\l8db\policy.json` |
| Linux | `/etc/l8db/policy.json` |

Ausgangspunkt: [organization-policy.example.json](organization-policy.example.json). Adressen, Kontakt und Signierer-Fingerabdruck ersetzen. Keine Zugangsdaten eintragen. Eine vorhandene ungültige oder unzureichend geschützte Richtlinie sperrt Backend-Aufrufe; es gibt keinen stillen Rückfall auf unverwaltete Einstellungen.

Auf Unix müssen die Datei und alle Elternordner root gehören und dürfen weder gruppen- noch weltbeschreibbar sein; Symlinks werden abgelehnt. Die IT installiert die Datei mit Modus 0644 und die Ordner mit 0755. Unter Windows dürfen ausschließlich SYSTEM und Administratoren Schreibrechte auf Datei und Richtlinienordner haben. Die Anwendung prüft diese ACL mit PowerShell. Verteilung und Änderungen erfolgen durch MDM, Intune, Gruppenrichtlinie oder die bestehende Softwareverteilung.

`settings` enthält ausschließlich die unterstützten Sicherheits-, Diagnose- und Update-Einstellungen. Diese Werte werden beim Start geladen und übersteuern lokale Setter, Zurücksetzen und gespeicherte Einstellungen. Die Oberfläche markiert sie als durch die IT verwaltet. KI, Erweiterungen, persönliche Synchronisation und externer MCP können zusätzlich am Backend gesperrt werden. Ein fehlerhafter Richtlinienpfad darf nicht als zentraler Entzug von Datenbankrechten verwendet werden: dafür den Datenbankzugang und gegebenenfalls Netzwerkzugang entziehen.

Der Backend-Cache läuft nach höchstens einer Minute ab und wird erst beim nächsten Aufruf neu gelesen; es gibt kein Hintergrundpolling. Team-Abgleich und manuelles Neuladen aktualisieren ihn sofort. Der externe MCP prüft die Richtlinie vor jeder Anfrage. Bereits gestartete Prozesse und Datenbankanweisungen werden durch eine Richtlinienänderung nicht rückwirkend beendet. Für sofortigen Entzug laufende DB-Sitzungen serverseitig beenden und Zugangsdaten sperren.

`connections` ergänzt die Benutzerdatei und gewinnt bei identischen IDs. Sicherheitsfelder einer Team-Verbindung bleiben verbindlich: Typ, Endpunkt, TLS, Lesemodus, Umgebung, Schemas, Cloud-Anmeldung und Netzwerkweg. Benutzername, Passwort, lokale SSH-Key-Datei und Agent-Socket bleiben gerätelokal. Persönliche Namen und Farben sind weiter möglich. Diese Clientkontrollen ersetzen keine serverseitigen Berechtigungen und sind kein Schutz gegen Administratoren, die das Programm ersetzen können.

Eine beschädigte Benutzerdatei unterdrückt keine geschützten Maschinenprofile: diese werden weiter geladen, die Benutzerdatei erscheint als Warnung. Die IT muss die Benutzerdatei anschließend korrigieren. Ohne Maschinenprofile bleibt eine ungültige Benutzerdatei ein Fehler.

`requireSignedReleases` erzwingt eine gültige Git-Commit-Signatur mit einem der ausdrücklich freigegebenen `trustedReleaseSigners`. Der Arbeitsplatz beziehungsweise Executor benötigt die passenden öffentlichen Schlüssel und bei SSH-Signaturen eine vertrauenswürdige Git-`allowedSignersFile`. Ein Prüfsummenvergleich allein belegt keine Herkunft. Geschützte Remote-Branches und verpflichtende Reviews separat im Git-Hosting einrichten.

## Rollen und Verantwortlichkeiten

| Verantwortlich | Aufgaben |
| --- | --- |
| IT / Arbeitsplatzbetrieb | Signierte stabile App, geprüfte Treiber, Richtlinie, Connection-Datei, Zertifikatsvertrauen, Updates und Rückfallversion verteilen. |
| DBA | Persönliche Logins; getrennte Lese-, Entwicklungs-, Deployment- und Administrationsrechte; Zugriffe testen und entziehen; Backups/PITR und Wiederherstellung betreiben. |
| Release-Verantwortliche | Freigegebene Signierer, geschützte Branches, unabhängige Reviews und Wartungsfenster festlegen. |
| Anwender | Ziel und Umgebung vor Änderungen kontrollieren; Commit/Rollback verstehen; bei unklarem Ausgang nicht blind wiederholen. |
| Support | Zuständigkeit und Eskalation in `owner`, `contact`, `description`, `runbook` jeder Team-Verbindung pflegen. |

Keine gemeinsam verwendeten Administratorkonten. Ein Analyseprofil erhält Leserechte in der Datenbank. Ein Entwicklungsprofil erhält Schreibrechte nur auf Development. Die Schema-Auswahl in der App ist kein Ersatz für GRANT/REVOKE und RLS.

## Arbeitsplatzdiagnose und CLI-Abnahme

```sh
l8db doctor -o json
l8db doctor --test-keychain --strict
l8db conn list
l8db conn test reporting
l8db query -c reporting "SELECT 1"
```

`doctor` gibt keine Verbindungsadressen oder Zugangsdaten aus. Standardmäßig ist der Schlüsselbund ausdrücklich ungeprüft. `--test-keychain` schreibt, liest und entfernt einen zufälligen Testeintrag. Development-Binaries verwenden den Development-Secrets-Speicher und melden ausdrücklich, dass damit die Produktions-Keychain nicht geprüft wurde. `--strict` liefert bei Warnungen einen Fehlercode. Optionale fehlende Datenbanktreiber sind kein pauschaler Fehler; die tatsächlich erforderlichen Treiber zusätzlich testen.

Für automatisierte CLI-Abnahme steht `bun run test:cli` bereit. Es verlangt das gebaute Binary und die explizit gesetzte Lab-URL `L8DB_CLI_TEST_PG_URL`. Es aktiviert die echten CLI-, Automatisierungs-, Prüf- und Benchmarktests und lässt fehlende Voraussetzungen nicht als Erfolg gelten. Diese Tests ausschließlich gegen eine wegwerfbare Lab-Datenbank ausführen.

Der CLI-Runner legt seine Testtabellen aus `tests/lab/cli-fixtures.sql` in dieser Lab-Datenbank an: 500 Kunden und zwei Millionen Benchmarkzeilen mit 128-Byte-Payload. Der Test prüft die tatsächliche Gesamtzeilenzahl vor der Messung. Die Tabellen bleiben bei einem manuell betriebenen Labor erhalten; das Integrationslabor entfernt seine komplette Datenbank beim Aufräumen.

Mit `L8DB_CLI_CHECKS=1 bun run test:integration` werden diese CLI-Suites im automatisch erzeugten PostgreSQL-/SSH-Labor ausgeführt und anschließend zusammen mit dem Labor aufgeräumt.

## Produktionsmigrationen

Der Rust-Executor liest Release-Manifeste aus dem bezeichneten Git-Commit und vergleicht Ausgangsstand, Vorgängerkette, SQL-Anweisungen, Schema-Zuordnung, Snapshots, Vor-/Nachbedingungen und Sitzungseinstellungen. Abweichungen werden vor Datenbankzugriffen abgewiesen. JSON-Manifeste müssen in der von l8db erzeugten Form bleiben; manuelle Änderungen an JSON-Escapes oder Zahlendarstellungen können den Prüfsummenvergleich ebenfalls abbrechen.

Für PostgreSQL gibt es die DBA-Vorlage [postgres-production-controls.sql](postgres-production-controls.sql). Sie verlangt getrennte bereits vorhandene Rollen und ein ausschließlich dafür vorgesehenes Kontrollschema. Aufruf nach DBA-Prüfung: `psql "$LAB_URL" -v control_schema=l8db_control -v control_owner=control_owner -v deployer=app_deployer -v reviewer=app_reviewer -v administrator=control_admin -f docs/postgres-production-controls.sql`. Die Vorlage prüft Schema und Rollentrennung und arbeitet in einer Transaktion.

Produktion benötigt explizite Deployer und Reviewer, verbindliche Vier-Augen-Freigabe mit getrennten DB-Identitäten und ein Kontrollschema außerhalb der Anwendungsschemas. Deployer dürfen Kontrollschema und Kontrolltabellen nicht besitzen und Regeln, Freigaben oder Journal nicht verändern oder löschen. Kontrollschema, Tabellen, Grants und Identitäts-Trigger richtet eine getrennte DBA-Rolle ein. PostgreSQL-Trigger für Journal und Freigaben müssen `l8db_authentic_actor` heißen und `ENABLE ALWAYS` verwenden. Sie müssen ACTOR auf `session_user` und CREATED_AT auf die serverseitige UTC-Zeit setzen und die zum Projekt berechtigten Identitäten prüfen. Oracle benötigt entsprechend `L8DB_JOURNAL_ACTOR` und `L8DB_APPROVAL_ACTOR`; der Deployer darf keine globalen Änderungsrechte besitzen.

Bestehende Produktionsziele mit ungeschützten Kontrolltabellen werden absichtlich blockiert. Die DBA muss vorhandene Kontrolltabellen einschließlich Historie und aktuellem Ledger in das getrennte Kontrollschema übernehmen, Rechte und Trigger einrichten und `ledgerSchema` im Ziel beziehungsweise in `database/team.json` anpassen. Den Übergang zuerst an einer Datenbankkopie prüfen und den Ledger mit dem freigegebenen Git-Release abgleichen. Ein leer neu initialisierter Ledger ersetzt diese Migration nicht.

Die App ersetzt keinen dauerhaft betriebenen zentralen Executor oder externen manipulationsgeschützten Auditdienst. Für entsprechende Anforderungen muss die Organisation diese Infrastruktur bereitstellen, externe Datenbank-Audits aktivieren, Zugänge kurzlebig ausstellen und Ausführung sowie Aufbewahrung dort kontrollieren. Ein lokaler Desktoplauf erhält dadurch nicht automatisch eine regulatorische Freigabe. Oracle-DDL kann implizit committen; ein Fehler oder Verbindungsabbruch bedeutet nicht, dass alle Änderungen zurückgerollt wurden.

## Abnahme je eingesetzter Plattform und Datenbank

1. Frisches Benutzerkonto: Installation und Start ohne Entwicklungswerkzeuge; korrekte Publisher-Signatur und Richtlinie.
2. Team-Datei: erstmaliger Import, eigene Anmeldung, lokale Key-Dateien, Änderung und Entfernung einer Verbindung, ungültige Datei, gesperrter Schlüsselbund.
3. Rechte: erlaubtes SELECT funktioniert; unzulässige Änderungen scheitern auch außerhalb der App mit demselben DB-Konto. Desktop, CLI, Automatisierung und MCP separat prüfen.
4. Schreibablauf: Einfügen/Ändern/Löschen, Commit und Rollback; Verhalten nicht transaktionaler Operationen erklären und prüfen.
5. Betrieb: Query-Abbruch, Tunnelverlust ohne Direktverbindung, Client-Neustart, offene Transaktion, unklare Commit-Antwort, Update mit offenen Arbeiten.
6. Wiederherstellung: repräsentative Sicherung in ein getrenntes Ziel wiederherstellen; Vollständigkeit und Berechtigungen prüfen; RPO/RTO protokollieren.
7. Last: tatsächliche Datenmengen, Latenzen, Speichergrenzen, Requestzahlen und Abbruch/Leerlauf messen. Native Ergebnisse und CPU-/Heap-Simulation getrennt dokumentieren.
8. Offboarding: DB-Login und gegebenenfalls IAM-/SSH-Zugänge sperren, laufende Sessions beenden und persönliche Geheimnisse entfernen. Das Entfernen der Team-Datei allein entzieht keinen Datenbankzugang.

Vor Freigabe je Schritt Verantwortlichen, Datum, Version/Commit, OS/Architektur, CPU/RAM, Serverversion, DB-Rolle und Ergebnis erfassen. Nicht geprüfte Schritte bleiben offen.

## Entwicklungsabnahme vom 1. November 2026

Lokale Maschine: macOS 27.0.1, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. Das PostgreSQL-/SSH-Labor läuft in isolierten Docker-Containern. Chromium und WebKit prüfen den gebauten Web-Client mit gemocktem Tauri-Transport; das sind keine nativen Windows-/Linux-Nachweise. Ein Development-Binary prüft außerdem nicht den produktiven OS-Schlüsselbund.

Neue Performance-Baselines auf dieser Maschine, jeweils ohne gelockerte Grenzen:

| Szenario | Umfang | Median / p95 | Grenze und Begrenzung |
| --- | --- | --- | --- |
| Richtlinien-Setter | 10.000 Schreibversuche | 2,76 / 3,27 ms | p95 < 100 ms; zwei Einstellungen, keine DB-Requests oder Leerlaufbenachrichtigungen |
| Native Richtliniendatei | 2.000 Profile, 283.808 Bytes | 9,67 / 9,97 ms | p95 < 100 ms; 10.000 Cachezugriffe in 0,43 ms ohne erneutes Dateilesen |
| Desktop-SQL-Leseschutz | 2.000 Spalten, 22.909 Zeichen SQL | 10,08 / 10,31 ms | p95 < 150 ms; höchstens 4 MiB Eingabe, null DB-Requests |
| Release-JSON | 2.000 Migrationen, 344.914 Bytes | 10,88 / 11,06 ms | p95 < 150 ms; null DB-Requests |
| Secret-Fehlerdiagnose | 10.000 unterschiedliche Accounts | 12,75 / 22,73 ms | p95 < 100 ms; maximal 128 IDs, im getesteten Workload < 4 KiB Zustand |
| Team-Abgleich unverändert | 2.000 private + 2.000 Teamprofile | 4,86 / 14,73 ms | bestehendes Budget unverändert; bestehende Referenzen bleiben erhalten |
| Team-Abgleich mit Änderung | dieselben 4.000 Profile | 28,88 / 50,90 ms | bestehendes Budget unverändert; keine zusätzlichen DB-Requests |
| Gesperrte Erweiterungsaufrufe | 2.000 RPC-Aufrufe | 4,24 / 15,22 ms | p95 < 250 ms; null Servicezugriffe und null zurückbehaltene Sitzungen |
| DuckDB-NULL-Konvertierung | 1 Mio. Quellzeilen, 1.000 Ergebniszeilen | 80,48 / 113,76 ms | p95 < 500 ms; < 100 KB Ergebnis-JSON, eine Abfrage je Lauf; einfache und verschachtelte NULL-Werte |
| PostgreSQL-Produktionskontrolle | fünf Kontrolltabellen, zwei Identitäts-Trigger | 290,82 / 402,67 ms | p95 < 500 ms; drei serielle Leseabfragen je Prüfung, kein Schreiben oder Hintergrundpolling |
| CLI-Abfrage | zwei Mio. Zeilen, 100 zurückgegeben | 442 / 472 ms | Median < 500 ms, p95 < 1.000 ms; bei 1.000 Ergebniszeilen Peak RSS 128,9 MB |
| Dashboard-SQL-Cache | 128 Abfragen mit je 1.000 Spalten | 16,34 / 17,44 ms | p95 < 250 ms; maximal 64 Einträge, 262.144 Textzeichen und 32.000 Tokens, kein DB-Request oder Leerlaufzugriff |

Der Dashboard-Cache war zusätzlich durch lange SQL-Texte aufgefallen. Vor der Größenbegrenzung lagen drei Prozessmessungen der 14 bestehenden Dashboard-Szenarien bei 529,45 / 518,28 / 525,23 MiB Peak RSS. Nach der Korrektur, einschließlich des zusätzlichen Cache-Szenarios, waren es 346,78 / 352,70 / 356,33 MiB. Die Prozessgrenze bleibt 512 MiB. Kleine Abfragen behalten weiterhin 64 LRU-Einträge; große Einzelabfragen werden korrekt verarbeitet, aber oberhalb des Cachebudgets nicht zurückbehalten.

Separater Chromium-Nachweis mit simuliert gedrosselter CPU: nominal 4-fach, kalibriert auf 4,6-fach bei Chromium 153.0.8010.12. Onboarding im Leerlauf: 1.000 DOM-Mutationen, Median/p95 12,0/12,7 ms, keine zurückbehaltenen Fixture-Knoten. Wechsel der Tabellenstile: 46,6/65,3 ms, konstante DOM-Knotenzahl. Das ist eine Simulation auf dieser Maschine und kein Nachweis für andere Hardware.

Diese Werte sind die erste Baseline der neuen Richtlinien- und Diagnosefunktionen, kein gemessener Vergleich zu einer früheren Implementierung. Parallele native Kompilierung verursachte Überschreitungen bestehender Performance-Szenarien; solche Läufe zählen nicht als bestanden. Erneute Prüfungen verwenden unveränderte Budgets. CPU-/Heap-Simulationen und Serverfamilien außerhalb des konkret genannten Labors sind damit nicht abgedeckt.

Für eine Unternehmensfreigabe bleiben die produktiven Signierzertifikate, MDM-Verteilung, Datenbankrollen, Wiederherstellung und gegebenenfalls zentraler Executor sowie externe Audit-Aufbewahrung durch den jeweiligen Betrieb einzurichten und abzunehmen. Die offene RSA-RustSec-Ausnahme ist in [PRODUCTION.md](../.github/PRODUCTION.md) dokumentiert.

Abgeschlossene lokale Prüfungen: Frontend-Build einschließlich TypeScript, Frontend-Lint, Rust-Formatierung, Rust-Check, Clippy für alle Targets mit und ohne Standardfeatures, 1.110 Rust-Tests mit einem Testthread, 40 echte CLI-End-to-End-Tests sowie das PostgreSQL-/SSH-Labor einschließlich Produktionsrollen und verloren gegangener Commit-Antwort. Die Core-Performance-Abnahme umfasst 186 Tests ohne Budgetverletzung; das Dashboard-Szenario liegt dort bei 350,34 MiB Peak RSS. Chromium und WebKit bestehen Produktions-CSP, Erweiterungsisolation und verwaltete Einstellungen mit Team-Zuständigkeiten. Der separate Onboarding-Test mit CPU-Simulation besteht ebenfalls.

Die konfigurierten Abhängigkeits-Audits bestehen mit den ausdrücklich dokumentierten RSA-/Deepmerge-Ausnahmen. Die ungefilterten Audits sind weiterhin nicht sauber. Produktive Signaturen, produktiver OS-Schlüsselbund, native Windows-/Linux-Läufe und reale Server anderer Datenbankfamilien sind durch diese macOS-Abnahme nicht nachgewiesen. Deaktivierte Lab-Tests werden nicht als bestanden gezählt.
