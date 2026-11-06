# Alltagshilfen für SQL und Datenrecherche

## SQL-Stände und Varianten

Der Button **SQL-Stände** in der SQL-Werkzeugleiste öffnet benannte Checkpoints dieser Verbindung und Datenbank. Sie bleiben lokal in IndexedDB erhalten, auch nach einem Neustart oder dem Schließen ihres ursprünglichen Tabs. KI-Stände der aktuellen Sitzung können mit **Behalten** dauerhaft übernommen werden. Ein Vergleich zeigt links den gespeicherten und rechts den aktuellen Text. **Im Editor wiederherstellen** sichert zuerst den aktuellen Text als eigenen Checkpoint und erhält Monacos Undo-Verlauf. Dabei wird kein SQL ausgeführt. Ein fehlgeschlagenes Speichern verhindert das Ersetzen.

**Letzten Erfolg vergleichen** zeigt den letzten erfolgreich ausgeführten SQL-Text für den aktuellen Tab und die aktuelle Datenbank. Fehler, abgebrochene Läufe und fehlgeschlagene Skripte ersetzen diesen Stand nicht. Bei Bind-Parametern bleiben die Platzhalter erhalten. Ein erfolgreicher DML-Lauf bedeutet hier nur erfolgreiche Ausführung, nicht zwingend einen Commit.

**Variante öffnen** legt einen unabhängigen Query-Tab mit dem aktuellen Text an. Das Original bleibt geöffnet. Die Variante speichert ihren Ausgangstext und kann ihn über **Original der Variante vergleichen** gegenüberstellen, selbst wenn der ursprüngliche Tab inzwischen geändert oder geschlossen wurde. Varianten übernehmen weder Dateibindung noch automatische Ausführung.

## Parametersätze

Im Bind-Parameter-Dialog lassen sich Werte unter einem Namen speichern, laden und löschen. Ein Satz gilt nur für dieselbe Verbindung, Datenbank und exakt denselben SQL-Text. Typen und NULL bleiben erhalten; fremde Parameter werden nicht übernommen. Laden führt keine Abfrage aus. Erst **Ausführen** verwendet die kontrollierten Werte. Werte werden nur durch **Werte merken** dauerhaft gespeichert.

## Arbeitsstände

Der Ordner-mit-Uhr-Button **Arbeitsstände** neben den Tabs sammelt Abfragen, Tabellen, Tabellenfilter, Sortierung, Spaltenbreiten, Editor-Anordnung und eine Notiz. Ein gespeicherter Arbeitsstand kann geöffnet, mit den aktuellen Tabs aktualisiert oder gelöscht werden. Das Öffnen ergänzt die vorhandenen Tabs und stellt die gespeicherten Ansichten vorhandener Tabellen wieder her. Abfragen öffnen als neue Entwürfe und werden nicht automatisch ausgeführt. Das Öffnen von Tabellen verwendet den normalen, bedarfsgesteuerten Tabellenabruf.

Verbindungskennwörter, Verbindung-URLs, Dateibindungen, Ergebnisse und Parameterwerte gehören nicht zum Arbeitsstand. Er gilt für die aktuelle Verbindung und Datenbank; ein Wechsel schließt den Dialog. Geteilte Fensteranordnungen sind weiterhin über die bestehenden gespeicherten Split-Ansichten verfügbar.

## Datensätze beobachten

In Tabellen mit Primärschlüssel steht per Rechtsklick **Datensatz beobachten** zur Verfügung. Der Bereich **Beobachtete Datensätze** zeigt Änderungen gegenüber dem bewusst gespeicherten Stand einschließlich alter und neuer Werte. Zusammengesetzte Primärschlüssel bleiben über erneutes Laden hinweg stabil; physische Zeilenkennungen werden nicht als dauerhafte Identität verwendet. Geänderte Zeilen erhalten eine dezente Hervorhebung, solange keine bestehende Markierung oder Zeilenregel Vorrang hat.

Verglichen werden ausschließlich bereits geladene Zeilen. Es gibt keine zusätzlichen Datenbankabfragen und kein Polling. **Nicht geladen** bedeutet ausdrücklich nicht gelöscht. **Stand übernehmen** aktualisiert den Vergleichspunkt; **Entfernen** beendet die Beobachtung. Bei aktiver Datenmaskierung sind die Beobachtungsfunktionen ausgeblendet. Große oder nicht vergleichbare Zellwerte werden begrenzt verarbeitet und als solche bezeichnet.

## Speichergrenzen

Alle neuen Stände werden lokal in IndexedDB gespeichert. Atomare Schreibtransaktionen verhindern, dass mehrere Fenster die gemeinsamen Grenzen überschreiten. Fenster informieren sich über einen Storage-Revisionsschlüssel; nach dem Schließen einer Ansicht werden ihre Listener entfernt und verspätete Leseantworten verworfen. Es gibt keine Hintergrundtimer.

- Checkpoints: 100 Einträge, zusammen 4 Millionen Zeichen; maximal 450.000 SQL-Zeichen pro Stand.
- Letzte Erfolge: 100 Einträge, zusammen 2 Millionen Zeichen; bei Bedarf werden die ältesten Erfolge verdrängt.
- Parametersätze: 100 Einträge, zusammen 1 Million Zeichen; höchstens 100 Parameter pro Satz.
- Arbeitsstände: 30 Einträge, zusammen 4 Millionen Zeichen; höchstens 50 Tabs und 10.000 Notizzeichen pro Stand.
- Beobachtungen: 200 Einträge, zusammen 2 Millionen Zeichen; höchstens 200 Spalten und 50.000 Zeichen pro Datensatz.
- Ein gespeicherter Eintrag ist insgesamt auf 500.000 Zeichen begrenzt. Zeichenbudgets umfassen Nutzdaten, Schlüssel, Namen und Gültigkeitsbereiche; sie sind keine Aussage über Prozess-RSS oder den exakten IndexedDB-Platzbedarf.

Benannte Stände werden bei Platzmangel nicht automatisch gelöscht. Die Oberfläche meldet das Limit und verlangt das Entfernen vorhandener Einträge. Quota- oder IndexedDB-Fehler werden angezeigt.

## Prüfungen

Die funktionalen Szenarien stehen in `tests/workbench-qol.test.ts`, die Performance-Grenzen in `tests/perf-workbench-qol.test.ts` und die Browserabläufe in `tests/workbench-qol-browser.test.ts`. Sie sind in die vorhandenen Core-Performance- und Browser-Runner aufgenommen.

Browser-Einzelaufruf: `L8DB_WORKBENCH_BROWSER=1 bun test tests/workbench-qol-browser.test.ts`, für WebKit `L8DB_WORKBENCH_BROWSER=webkit`. Die Datenbank-Bridge wird im Browser mit deterministischen Antworten ersetzt; dies prüft die echten React-/Monaco-Abläufe, keine echten Datenbanktreiber.

### Gemessene lokale Performance

Gemessen am 2. November 2026 auf macOS/Darwin arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. IndexedDB wurde in den Core-Tests durch `fake-indexeddb` bereitgestellt. Die Werte sind lokale Einzelmessungen unter der vorhandenen Systemlast; sie belegen keine Ergebnisse auf Windows, Linux, schwächeren Geräten oder echten Datenbankservern.

| Szenario | Median | p95 | Bestehendes Testlimit dieser Funktion |
| --- | ---: | ---: | ---: |
| Vergleich ohne Beobachtungen, 100.000 geladene Zeilen | 0,0015 ms | 0,0119 ms | Keine Zeilensuche ohne Beobachtungen |
| 200 Beobachtungen, 100.000 Zeilen, zusammengesetzte Schlüssel | 123,41 ms | 141,63 ms | p95 < 250 ms |
| SQL-Checkpoint mit 100.000 Zeichen speichern und löschen | 1,93 ms | 20,01 ms | p95 < 150 ms |
| Letzten Erfolg mit 100.000 SQL-Zeichen ersetzen | 0,73 ms | 0,82 ms | p95 < 100 ms |
| Variante in einem Arbeitsbereich mit 50 Tabs anlegen | 0,0090 ms | 0,0144 ms | p95 < 50 ms |
| Arbeitsstand mit 50 Tabs und je etwa 8.000 SQL-Zeichen erfassen und wieder öffnen | 0,38 ms | 1,81 ms | p95 < 100 ms |
| Parametersatz mit 100 Werten zu je 1.000 Zeichen speichern und löschen | 0,98 ms | 4,21 ms | p95 < 100 ms |

Nach zehn weiteren Zeilenvergleichen und vollständiger Bun-GC betrug die gemessene Heap-Differenz 2.031 Bytes gegenüber dem vorbereiteten Datensatz; das Testlimit liegt bei 8 MiB. Der Vergleich hält höchstens 200 Ergebnisverweise, keinen vollständigen Index aller 100.000 Zeilen. Tabelle und Beobachtungsliste teilen sich dieselbe Leseantwort und dasselbe Vergleichsergebnis. 15 gleichzeitige große Arbeitsstand-Schreibversuche hielten das unveränderte Budget von 4 Millionen Zeichen ein. Im Idle entstand keine Benachrichtigung; alle lokalen Operationen verursachten null Datenbankabfragen.

Diese Messungen betreffen die neuen Funktionen. Sie ersetzen weder Browser-Frame-Messungen noch echte Treiber- oder Desktop-E2E-Ergebnisse. Die leere Beobachtungsliste ist die gemessene Ausgangsbasis; es wird kein historischer Geschwindigkeitsgewinn behauptet.

### Funktionale Ergebnisse und Grenzen der Abnahme

- Produktionsbuild (`bun run build`) einschließlich TypeScript-Prüfung: erfolgreich. Der finale CSS-Stand wurde zusätzlich mit Vite gebaut. Biome auf allen 35 geänderten TypeScript-Dateien: keine Befunde.
- Neue funktionale Tests: 9 Szenarien erfolgreich. Eine zunächst falsch auf einen asynchronen Fehler geprüfte synchrone Validierung wurde im Test korrigiert; nur dieses zuvor fehlgeschlagene Szenario wurde erneut ausgeführt.
- Neue Performance-Tests: alle 3 Szenarien erfolgreich; feste Budgets unverändert.
- Neue Browserabläufe in Chromium und WebKit: erfolgreich. Geprüft wurden SQL-Erfolg und nachfolgender Fehler, dauerhafte Checkpoints über Reload, Änderungen zwischen zwei Fenstern, Varianten, Parametersätze über Reload, Arbeitsstände ohne automatische SQL-Ausführung sowie Zeilenbeobachtung ohne zusätzliche Datenbankabfragen. WebKit prüfte zusätzlich Undo/Redo nach dem Wiederherstellen, Löschen und Übernehmen von Ständen, Hell-/Dunkelmodus und Darstellungen mit 390, 760 und 1.440 Pixeln.
- Bestehende Browser-Regressionen: Tabellenbearbeitung und Tabellenzustand in Chromium/WebKit sowie Query-Workspace und bestehende QoL-Dialoge. Ein durch die zusätzliche SQL-Schaltfläche ausgelöster Toolbar-Überlauf wurde durch eine kompakte Schaltfläche und geringere Abstände behoben; der betreffende Query-Workspace-Test wurde danach erneut ausgeführt.
- Gesamte Frontend-Suite einmal ausgeführt: 472 isolierte Testdateien, 3.770 bestandene und 365 übersprungene Tests im ursprünglichen Lauf; 22 fehlgeschlagene Dateien einschließlich des inzwischen korrigierten neuen Validierungstests. Die verbleibenden 21 Dateien scheiterten an Zeitbudgets in unveränderten Funktionen. Diese Funktionen wurden nicht geändert und ihre Budgets nicht gelockert. Ohne einen gesonderten Ausgangslauf wird keine Aussage behauptet, dass dieselben Messfehler bereits vor dieser Änderung aufgetreten sind.

Die verbleibenden Fehlerdateien:

- `tests/ai-editor-context.test.ts`
- `tests/app-themes.test.ts`
- `tests/button-disabled-reason.test.tsx`
- `tests/perf-ai-editor-context.test.ts`
- `tests/perf-ai-editor-features.test.ts`
- `tests/perf-ai-persist.test.ts`
- `tests/perf-blog-suggestions.test.ts`
- `tests/perf-budget.test.ts`
- `tests/perf-connection-import-datagrip.test.ts`
- `tests/perf-history-modal-boundary.test.ts`
- `tests/perf-home-atlas.test.ts`
- `tests/perf-invalid-objects.test.ts`
- `tests/perf-split-groups.test.ts`
- `tests/perf-sql-intellisense.test.ts`
- `tests/perf-ui-plugins.test.ts`
- `tests/perf-versioning-pipeline.test.ts`
- `tests/perf-versioning-review.test.ts`
- `tests/sql-signature-help.test.ts`
- `tests/supabase-studio-redesign.test.ts`
- `tests/team-sync.test.ts`
- `tests/transaction-sql-changes.test.ts`

Die Originalprotokolle liegen lokal in `test-artifacts/unit/`. Die Vollsuite ist damit ausdrücklich nicht vollständig grün. Reale Datenbanktreiber, eine installierte Tauri-App, Windows, Linux und CPU-/Heap-Simulationen wurden für diese rein frontendseitigen Ergänzungen nicht ausgeführt.
