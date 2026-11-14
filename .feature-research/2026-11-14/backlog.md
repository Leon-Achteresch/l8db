# Backlog · aktualisiert nach Runde 13

**Aktuelle Entscheidung, 2026-11-14:** Herkunft bleibt vorn. Neu auf Platz 2: verlässlicher ClickHouse-Abbruchstatus, gestützt durch S66 und einen konkreten statischen Codehinweis; reale l8db-Betroffenheit offen. Bestehende Abbruchanzeige, PostgreSQL-Bestätigung und Sitzungsaktionen bleiben anerkannt. NULL steht jetzt auf Platz 3, Kindtabellenfilter auf Platz 4; deren Evidenz ist unverändert. Revisions- und enger Mischbestand-Suchpfad sind ohne neue Fundstelle beendet. [README.md](README.md) und [Runde 13](sources.md#runde-13--bewusster-abbruch-und-clickhouse-status) haben Vorrang; alte Artefakte bleiben erhalten.

## Aktuelle Kandidaten

| Priorität | Ergänzung | Nutzen und Evidenz | Entscheidung |
|---|---|---|---|
| 1 | Herkunft gespeicherter SQL-Abfragen, Filter weiter prüfen | S43 und S59 stützen die Zuordnung unabhängig aktuell; S55 belegt den Mischbestand nur von 2025. l8db hat Namens-/SQL-Suche und Verbindungsverlauf, aber keine Herkunft an benannten Abfragen; S58 belegt Alternativen | B · Herkunft vorn, Zusatznutzen eines freiwilligen Filters für gemischte Bestände offen; allgemeine Abfragen standardmäßig sichtbar lassen |
| 2 | ClickHouse-Abbruchstatus verlässlich anzeigen | Nach Stopp zwischen angefordertem und bestätigtem Ende unterscheiden; S66 erklärt ASYNC, l8db setzt dessen HTTP-Erfolg bereits in eine bestätigte Abbruchmeldung um. S64/S65 zeigen Engine-Grenzen, nicht dasselbe Verhalten in l8db | B · enge statisch gestützte Lücke; eigener Laufzeitfall und Häufigkeit offen, keine neue Aufgabenverwaltung |
| 3 | SQL-NULL und JSON-null erhalten und unterscheiden | Filter und Anzeige sollen dieselben Wertarten unterscheiden; S47 direkter Einzelbericht, statischer MySQL-Codehinweis. S51 betrifft dagegen erwartete SQL-Konvertierung; S52 beschreibt eine vorhandene Konkurrenzlösung zur Anzeige | B · keine Hochstufung: unabhängiger aktueller Gleichfall und Laufzeitbestätigung fehlen; kein reiner Beschriftungswechsel |
| 4 | Filter über eingehende Beziehungen in der Tabellenansicht | Elternzeilen über Kinddaten finden; JOIN-Builder bietet den Suchweg, aber nicht denselben Ergebnisumfang; S45 weiter nur vermittelt | B · nachrangig, unabhängige aktuelle Nachfrage nicht bestätigt |

**Abgeschlossener Suchpfad: frühere Fassung einer benannten Abfrage wiederherstellen.** S60/S61 belegen vorhandene Konkurrenzlösungen, S62/S63 andere Verlustaufgaben. l8db warnt vor dem Überschreiben und hat mehrere Wiederherstellungswege, aber im geprüften Speicherpfad keine abrufbare Revisionsliste. Auf Nutzerwunsch ohne neue Originalquelle keine weitere Suche; keine allgemeine Versionsverwaltung ableiten.

## Historischer breiter Backlog mit aktualisierten Entscheidungen

Stand 2026-11-14, geprüft gegen `27fe90e9481e0d344bcf179badbcc07fecf7833f`. **A** = Konzept für Validierung ausarbeiten; **B** = Nutzeraufgabe genauer prüfen; **C** = Hypothese zurückstellen. Keine Implementierungszusage. Aufwand: S ≈ 2–5, M ≈ 6–15, L ≈ 16–30 Entwicklungstage, einschließlich gezielter Tests; grobe Einschätzung ohne Spike, keine Terminplanung.

Evidenzstärke beschreibt die konkrete Aufgabe, nicht die Marktgröße. Nutzen/Differenzierung sind unsere Einschätzung. Die folgenden Ränge und ausführlichen Abschnitte dokumentieren den Ausgangsstand; die aktuelle Priorität steht oben.

| Alter Rang | Idee / neue Fähigkeit | Nutzen | Evidenz | Differenzierung | Aufwand | Entscheidung |
|---|---|---|---|---|---|---|
| 1 | **Vorhandene Verbindungsinformationen zusammenführen** | Möglich: Rückfragen bei Fehlersuche sparen | Mittel für Verbindungsprobleme, niedrig für Zusatzaufgabe der Übersicht | Niedrig: präzise Meldungen, Verbindungstest, Statusanzeige, doctor und Treiberdiagnose schon vorhanden | S–M | C · allgemeine Übersicht zurückstellen; S43 als eigene, engere Aufgabe prüfen |
| 2 | **Spaltenansicht gezielt in eine Datei übernehmen** | Möglich: erneute Spaltenauswahl sparen | Niedrig für Zusatzbedarf in l8db; mehrfach erfolglos gegengeprüft | Niedrig: TSV/JSON-Kopieren, XLSX-Spaltenwahl und BLOB-Dateispeichern schon vorhanden | S–M | C · Pfad auf Nutzerwunsch vorerst abgeschlossen |
| 3 | **CSV-Fehlersammlung, allgemeinen Vollcheck zurückstellen** | Mehrere Dateikorrekturen bündeln | S33 direkter, alter Fall; S34 vorhandene Engine-Funktion | Integration statt neuer Parser | Offen | B · aktuelle Mehrfachfehlerfälle fehlen |
| 4 | **Lokale explizite Beziehungen** | Hoch für Legacy-/Analytics-Schemas ohne FKs | Niedrig–mittel: S08 alt, S14 heutiger Wettbewerbsstandard | Niedrig allein; besser mit bestehendem Drawer | M | B · 3 reale Schemas ohne FKs suchen |
| 5 | **Große SELECT-Ergebnisse vergleichen** | Hoch für Abgleich über dem Ergebnislimit | Niedrig: S15 belegt Angebot, keine belastbare aktuelle Beschwerde gesammelt | Mittel im bestehenden Multi-Target-Ablauf | L | C · Nachfrage vor Backend-Spike |
| 6 | **Zusammenhängende Testdaten-Teilmenge** | Hoch: einen Fehlerfall mit Eltern/Kindern lokal nachstellen | Niedrig: S09 belegt Teilmenge, nicht FK-Abschluss; Erweiterung ist Schlussfolgerung | Mittel: an bestehende Maskierung anknüpfen | L | C · fachlichen Bedarf validieren |
| 7 | **Begrenzte Datenwertsuche über gewählte Tabellen** | Mittel: bekannte ID finden, wenn die Tabelle unbekannt ist | Niedrig: S20/S21 historische Suchaufgabe/Workaround; S16 grenzt geladene Suche ein | Niedrig gegenüber etablierten Clients | M–L | C · Produktionslast ist erhebliche Hürde |
| 8 | **Sitzungskontext vergleichen** | Mittel: gleiche SQL, anderes Verhalten erklären | Niedrig–mittel: S10 konkretes Zeitzonenmissverständnis; Verallgemeinerung unbewiesen | Mittel als kleine Diagnose-Erweiterung | S–M | B · mit Verbindungsdiagnose gemeinsam validieren |

## 1 · Export-Herkunft und Abschlussbeleg

**Problemcluster:** geladene Teilmenge, erneute Abfrage, Limit und tatsächlicher Abschluss werden verwechselt. l8db besitzt bereits Full-/Loaded-Export, Snapshot-Lesen, Maskierung und Kürzungswarnung. Neu sind einheitliche explizite Quellenwahl und ein nach dem Toast verfügbarer Beleg. Details und MVP: [concepts.md](concepts.md#1--export-herkunft-und-abschlussbeleg).

Einstieg: [use-data-export.ts](/Users/leon/Projekte/l8db/src/features/export/data-export-dialog/use-data-export.ts), CSV-/XLSX-Pfade in [export](/Users/leon/Projekte/l8db/src/features/export), [export.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/export.rs). Risiken: Beleg darf keine vollständige Datenbank behaupten, wenn nur gefilterte Abfrage oder Teilmenge exportiert wurde; Belegfehler und Datenfehler getrennt behandeln. Abhängigkeit: vorhandenes `truncated` und eingefrorene Request-Quelle.

## 2 · Verbindungsdiagnose in Stufen

**Problemcluster:** derselbe Timeout-Text kann TCP, SSH, TLS, Anmeldung oder Pool betreffen. l8db hat bereits Timeouts, Tunnelüberwachung und Reconnectmeldungen. Neu: typisierte Stufenereignisse und ein einmalig aufrufbarer Diagnosebericht.

Einstieg: [test-result-status.tsx](/Users/leon/Projekte/l8db/src/features/connections/connection-editor/test-result-status.tsx), [network.ts](/Users/leon/Projekte/l8db/src/lib/ssh/network.ts), [tunnel-failures.ts](/Users/leon/Projekte/l8db/src/lib/ssh/tunnel-failures.ts), [pool.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/pool.rs), [execution.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/execution.rs). Risiken: nicht jede Bibliothek legt alle Stufen offen; dann „nicht einzeln messbar“ statt erfundener Ursache. SSH-Ziel und TLS-Hostname sauber trennen. Nie direkte Verbindung als Ersatz testen; nie DML/Commit automatisch wiederholen. Abhängigkeit: strukturierte Fehler im Backend, Request-IDs und Abbruch.

## 3 · Import-Prüflauf ohne Schreiben

**Problemcluster:** ein Import meldet späte/falsche Fehler oder nur einen Abbruch; der Nutzer weiß nicht, was an der Datei zu korrigieren ist. l8db lokalisiert bereits echte Schreibfehler über Batch-Replay und meldet Rollbacks. Neu: komplette Datei **vorher** rein lesend parsen und konservativ gegen bekannte Typ-/NULL-Regeln prüfen, mehrere Fundstellen zusammenführen.

Einstieg: [use-csv-import.ts](/Users/leon/Projekte/l8db/src/features/import/csv-import-panel/use-csv-import.ts), [csv-import-runner.ts](/Users/leon/Projekte/l8db/src/lib/csv-import-runner.ts), [import.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/import.rs), [import_source.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/import_source.rs). Risiken: lokale Prüfung kennt Unique/FK/Trigger nicht; keine Erfolgsgarantie. Datei/Mapping nach Änderung macht Bericht ungültig. Kein „Dry Run mit INSERT und Rollback“, weil Nebenwirkungen und Anbieterunterschiede. Abhängigkeit: Wiederverwendung des bestehenden Parsers statt zweiter Parserlogik.

## 4 · Lokale explizite Beziehungen

**MVP:** Beziehung `legacy_orders.account_ref → accounts.external_id` bewusst als lokales Metadatum hinterlegen; im bestehenden FK-Drawer navigieren; Kennzeichen „lokal“; zusammengesetzte Schlüssel oder explizite Beschränkung. Keine automatische Namensheuristik, keine DDL, kein Schreibpfad.

Code-Neuheitsprüfung: [fk-links.ts](/Users/leon/Projekte/l8db/src/features/table/data-table/fk-links.ts) arbeitet mit kataloggelieferten `ForeignKeyInfo`; [fk-drawer-stack.ts](/Users/leon/Projekte/l8db/src/lib/fk-drawer-stack.ts) liefert Navigation. Keine lokale Beziehungsdefinition in diesen Pfaden oder ER-Diagramm gefunden. Speicherung nach Verbindung/Datenbank/Schema, `syncAcrossWindows`, Rename/Drop-Invalidierung nötig. S08 beweist historische Persistenzprobleme, S14 zeigt bereits etablierte Konkurrenz. Kein Alleinstellungsmerkmal behaupten.

## 5 · Große SELECT-Ergebnisse vergleichen

**MVP-Hypothese:** explizit gestarteter, lesender Vergleich zweier SELECTs mit bestätigtem zusammengesetztem Schlüssel, bounded Backend-Snapshot/Spill und sichtbaren Grenzen. Kein Erhöhen des UI-Limits, keine implizite Neuausführung alter Ergebnisse, zunächst kein Sync-SQL.

Neuheitsprüfung: [result-compare.ts](/Users/leon/Projekte/l8db/src/lib/result-compare.ts) lehnt gekürzte Ergebnisse und Ergebnisse ab Standardlimit ab; Snapshots sind auf 999 Zeilen begrenzt. [data_compare.rs](/Users/leon/Projekte/l8db/src-tauri/src/db/data_compare.rs) vergleicht bereits Tabellen mit anderen Grenzen; beliebige SELECT-Quellen sind der Zusatz. Risiken: Key-Duplikate, RAM/Disk, fehlender gemeinsamer Zeitpunkt, schwerer Quellquery. Hoher Aufwand, schwacher Nachfragebeleg → zurückstellen.

## 6 · Zusammenhängende Testdaten-Teilmenge

**MVP-Hypothese:** eine Startzeile plus ausdrücklich ausgewählte FK-Kanten als Vorschau; harte Zeilen-/Tiefenlimits und deterministische vorhandene Maskierung. Nur SQL-Paket für lokale Testdaten; keine automatischen Produktions-/Zielschreibzugriffe.

Neuheitsprüfung: [branching](/Users/leon/Projekte/l8db/src-tauri/src/branching) bietet Datenbankkopien und relationserhaltende Maskierung, Versioning bietet Seeds, Transfer bietet Tabellen. Ein Startdatensatz-getriebener FK-Abschluss wurde in diesen Pfaden nicht gefunden. Abhängigkeit zu Idee 4 nur für fehlende echte FKs. Risiken: Graph-Explosion, Zyklen, Teilmengen-Vollständigkeit und personenbezogene Werte. S09 ist lediglich angrenzender Beleg. Erst validieren, nicht als „neues Branching“ verkaufen.

## 7 · Begrenzte Datenwertsuche

**MVP-Hypothese:** Nutzer wählt höchstens zehn Tabellen/Spalten; exakte Suche für ID/UUID, explizite langsame Textsuche. Eine Abfrage gleichzeitig, Zeitbudget, Abbruch, Maskierung, keine Scans beim Tippen. Ergebnisse nennen auch übersprungene/fehlgeschlagene Tabellen.

Neuheitsprüfung: [object-search-dialog.tsx](/Users/leon/Projekte/l8db/src/features/objects/object-search-dialog.tsx) sucht Spaltennamen und Routinenquelltext; Ergebnis-/Grid-Suche betrifft geladene Werte. Neue Aufgabe: Tabelle für einen bekannten Wert finden. Einstieg [catalog.ts](/Users/leon/Projekte/l8db/src/lib/db/catalog.ts) plus eigener lesender Adapterpfad. Risiko Full Scan trotz LIMIT; DB-Timeout ist zwingend. Historische Originalaufgabe durch S20/S21 ergänzt; heutige Nachfrage und l8db-Passung bleiben unbestätigt. Nicht priorisieren.

## 8 · Sitzungskontext vergleichen

**MVP:** zwei bewusst aufgenommene, redigierte Kontexte gegenüberstellen: Datenbank, Rolle, search_path, Server-/Session-Zeitzone, Isolation, Read-only. Werte gelten nur für die geprüfte physische Sitzung. Keine automatische SET-Anweisung, keine Änderung des Servers.

Neuheitsprüfung: [sessions](/Users/leon/Projekte/l8db/src/features/sessions) zeigt Server-Sitzungen; [timestamp-display-menu.tsx](/Users/leon/Projekte/l8db/src/features/table/timestamp-display-menu.tsx) ändert Anzeige. Kein expliziter paarweiser Kontextvergleich dort oder im Connection-Editor gefunden. Einstieg als Erweiterung des Diagnoseberichts aus Idee 2; keine eigene Hauptnavigation. Risiko Pool-Sitzung ungleich Query-Sitzung, falsche Kausalitätsbehauptung. S10 stützt die konkrete Zeitzonenaufgabe, weitere Felder bleiben Hypothese.

## Bewusst nicht vorgeschlagen

SQL-History, Arbeitsstände, Parametersätze, Result-Snapshots, Planvergleich, Zeitzonenschalter, Spaltenprofile, Maskierung, IAM-/Entra-Login, einfache FK-Navigation, DML-Vorschau, Team-Verbindungen, Backup, MCP, Notebooks und Automationen existieren. Die ältere `docs/research/automation-features.md` und `docs/release-1.0.md` sind kein verlässlicher aktueller Gap-Katalog. Kein neues AI-Chat-Feature ohne neue belegte Aufgabe.
