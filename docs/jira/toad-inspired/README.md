# Jira-Backlog: sinnvolle Toad-Funktionen für l8db

Stand: 6. September 2026. **75 kleine Feature-Tickets als einzelne Markdown-Dateien.** Die IDs `L8DB-PLAN-*` sind lokale Planungsnummern; es wurden keine Tickets in einer Jira-Instanz angelegt.

## Empfehlung

l8db sollte zuerst die tägliche Arbeit mit SQL, Ergebnissen und Datentransfer vertiefen. Datei-Öffnen/-Speichern, gezielte SQL-Ausführung, brauchbare Ergebnisfilter und vollständige Objektsuche schließen konkrete Lücken im vorhandenen Code. Anschließend lohnen sich CSV-Import, klar begrenzte Vergleichsfunktionen und ein besserer Sitzungsmonitor.

Die breite Provider-Registry macht gemeinsame Oberflächenfunktionen besonders wertvoll. Funktionen, die Daten schreiben oder stark vom Dialekt abhängen, beginnen ausdrücklich bei nativem PostgreSQL. Die Unterstützung einer PostgreSQL-kompatiblen Marke ist keine automatische Zusage gleicher Kataloge oder DDL-Fähigkeiten.

Den vollständigen Toad-Funktionsumfang nachzubauen wäre für den derzeitigen l8db-Stand wenig sinnvoll. Oracle-Verwaltung, Debugger, komplette Optimizer- und Monitoring-Suiten sowie ein eigener Git-Client würden jeweils große eigenständige Produktbereiche eröffnen. Ergänzend beschreiben [L8DB-PLAN-063](L8DB-PLAN-063-used-by-analyse.md) bis [L8DB-PLAN-075](L8DB-PLAN-075-zeile-duplizieren-edit.md) bewusst kleine Slices aus zuvor zurückgestellten Bereichen (Used-By-Analyse, Synonyme, Jobs, Regex-Helper, Schema-Transfer, Debugger-Einstieg, DBMS-Output, Prozeduren, Kompilieren, Drop/Rename/Alter/Audit, Performance-Test, Migrationsskripte, Duplizieren im Edit-State). KI-Assistenten und ein MCP-Server bleiben vorerst zurückgestellt: Der Nutzen der konkreten Editor- und Datenfunktionen ist im aktuellen Code direkter erkennbar.

Die Auswahl beruht auf einer statischen Prüfung der Feature-Module, Stores, Bridge und Provider-Architektur sowie dem [Toad-Audit](../../toad-for-oracle-feature-audit.de.md). Es wurde keine laufende Installation funktional getestet. „Nicht erkennbar“ bedeutet: im geprüften Code kein entsprechender Ablauf gefunden. Der Arbeitsstand ist kein unveränderlicher Release-Snapshot und ist vor Umsetzung nochmals abzugleichen.

## Prioritäten und Größe

| Priorität | Anzahl | Bedeutung |
|---|---:|---|
| P1 | 20 | Zuerst einplanen: häufige Aufgaben, klarer bestehender Bedarf oder notwendige Vorstufe |
| P2 | 38 | Danach: gezielte Produktivitätsgewinne und vertiefte Workflows |
| P3 | 17 | Später: Nutzen prüfen, sobald die häufigen Arbeitsabläufe ausgereift sind |

1 SP bedeutet sehr kleiner Eingriff, 2 SP kleiner Funktionsschritt, 3 SP begrenzter Ablauf über mehrere Stellen und 5 SP ein enger, aber technisch anspruchsvoller Schritt. Das sind grobe relative Schätzungen, keine Tagesangaben oder Lieferzusagen. Abhängigkeiten gehen vor der Priorität. Ein 5-SP-Ticket ist vor Umsetzung technisch zu verfeinern, falls der benannte Umfang nicht in einen kleinen Arbeitsabschnitt passt.

## Empfohlener Start

Diese zehn Tickets bilden eine überschaubare erste Auswahl; die P1-Liste ist nicht als einzelner Sprint gemeint:

1. [L8DB-PLAN-006 – SQL-Dateien in einem Query-Tab öffnen](L8DB-PLAN-006-sql-datei-oeffnen.md)
2. [L8DB-PLAN-007 – Query-Tabs als SQL-Datei speichern](L8DB-PLAN-007-sql-datei-speichern.md)
3. [L8DB-PLAN-009 – Nur markiertes SQL ausführen](L8DB-PLAN-009-sql-auswahl-ausfuehren.md)
4. [L8DB-PLAN-010 – PostgreSQL-Statement unter dem Cursor ausführen](L8DB-PLAN-010-sql-cursorstatement.md)
5. [L8DB-PLAN-013 – SQL-Formatierung nach Provider auswählen](L8DB-PLAN-013-formatter-dialekt.md)
6. [L8DB-PLAN-018 – Abfrageergebnisse lokal sortieren](L8DB-PLAN-018-ergebnisse-sortieren.md)
7. [L8DB-PLAN-019 – Abfrageergebnisse lokal filtern](L8DB-PLAN-019-ergebnisse-filtern.md)
8. [L8DB-PLAN-020 – Text in geladenen Grid-Zellen suchen](L8DB-PLAN-020-grid-textsuche.md)
9. [L8DB-PLAN-037 – Objektsuche über alle Schemas vervollständigen](L8DB-PLAN-037-globale-objektsuche.md)
10. [L8DB-PLAN-004 – Verbindungsfarbe im Arbeitsplatz anzeigen](L8DB-PLAN-004-verbindungsfarbe.md)

Danach bieten sich folgende zusammenhängende Schritte an:

- **Profiltransfer:** [L8DB-PLAN-001](L8DB-PLAN-001-profile-exportieren.md) → [L8DB-PLAN-002](L8DB-PLAN-002-profile-importieren.md)
- **CSV-Datentransfer:** [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) → [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md) → [L8DB-PLAN-035](L8DB-PLAN-035-csv-spaltenmapping.md) → [L8DB-PLAN-036](L8DB-PLAN-036-csv-import-ausfuehren.md)
- **Große Exporte:** [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) → [L8DB-PLAN-031](L8DB-PLAN-031-vollstaendiger-tabellenexport.md)
- **Wiederverwendbare SQL-Bausteine:** [L8DB-PLAN-011](L8DB-PLAN-011-snippets-verwalten.md) → [L8DB-PLAN-012](L8DB-PLAN-012-snippets-einfuegen.md)
- **Datei-Workflow:** [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md) → [L8DB-PLAN-007](L8DB-PLAN-007-sql-datei-speichern.md) → [L8DB-PLAN-008](L8DB-PLAN-008-externe-dateiaenderung.md)
- **Grid-Analyse:** [L8DB-PLAN-021](L8DB-PLAN-021-spalten-fixieren.md) → [L8DB-PLAN-022](L8DB-PLAN-022-grid-layoutprofile.md) → [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md) → [L8DB-PLAN-024](L8DB-PLAN-024-auswahl-aggregieren.md)
- **Planvergleich:** [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md) → [L8DB-PLAN-046](L8DB-PLAN-046-explain-laden.md) → [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md)
- **Query Builder:** [L8DB-PLAN-054](L8DB-PLAN-054-query-builder-basics.md) → [L8DB-PLAN-055](L8DB-PLAN-055-query-builder-fk-join.md)
- **Datenvergleich:** [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md) → [L8DB-PLAN-057](L8DB-PLAN-057-datendifferenz-sql.md)
- **Sitzungsdiagnose:** [L8DB-PLAN-048](L8DB-PLAN-048-blocking-sessions.md) → [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md) → [L8DB-PLAN-050](L8DB-PLAN-050-session-gruppierung.md)

Die Reihenfolge einer Zeile beschreibt den sinnvollen Ablauf; verbindliche Abhängigkeiten stehen zusätzlich im jeweiligen Ticket. Ein lesender Vergleich wird zuerst eigenständig brauchbar, bevor ein Änderungsskript ergänzt wird.

## Bereits vorhandene Grundlagen

| Bereich | Im Code vorhanden | Konsequenz für die Auswahl |
|---|---|---|
| Verbindungen | Profile, Tags, Suche, Tests, SSL, SSH und OS-Keychain | Ergänzungen für Transfer, Favoriten und Kontextfarbe |
| SQL-Editor | Monaco, Completion, Formatierung und SQL-Lint | Vorhandene Fähigkeiten erweitern; Standard-Suche und Syntaxhervorhebung nicht neu bauen |
| Abfrageorganisation | Automatischer Verlauf, benannte Queries und persistierte Query-Texte | Transfer und Snippets statt zweiter History-Implementierung |
| Arbeitsplatz | Persistierte Tabs pro Verbindung und bis zu vier Split-Panes | Nur benannte Aufgabenstände ergänzen |
| Tabellenbrowser | Pagination, Sortierung, Filter, Inline-Änderung, Duplizieren, Löschen, Zellvorschau, FK-Navigation | Detailergänzungen und besserer Ergebnisgrid |
| Spaltenlayout | Persistierte Reihenfolge und Sichtbarkeit | Fixierung und benannte Profile statt erneuter Basispersistenz |
| Datenexport | CSV und JSON aus geladenen Daten | Weitere Formate, Optionen und explizit vollständiger Export |
| Import | SQL-Datei lesen und Statements ausführen | CSV als neuer, separat validierter Ablauf |
| Schema | Tabellen, Views, Funktionen, Packages und weitere providerabhängige Objekte | Suche, Favoriten, DDL-Vorschau und begrenzter Vergleich |
| EXPLAIN | Baumansicht für EXPLAIN und ANALYZE | Speichern, Offline-Öffnen und Vergleich |
| ER-Diagramm | Layout, Zoom und PNG-/SVG-/PDF-Export | Nur fokussierte Teilgraphen ergänzen |
| Sitzungen | Session-/Lock-Listen, Polling, Cancel und Terminate | Blocking-Beziehungen, Filter und Gruppierung |
| Transaktionen | Änderungsübersicht, Commit/Rollback | In neuen Schreibabläufen wiederverwenden |

Die [Entscheidung über alle 75 Toad-Kategorien](ENTSCHEIDUNG.md) dokumentiert auch die nicht ausgewählten Bereiche. Die ursprüngliche Auswahl bezog 119 unterschiedliche Toad-Inventareinträge ein; [L8DB-PLAN-063](L8DB-PLAN-063-used-by-analyse.md) bis [L8DB-PLAN-075](L8DB-PLAN-075-zeile-duplizieren-edit.md) verlinken jeweils ihre zusätzlichen Einträge. Zusammengehörige Mikrooptionen sind zu einem kleinen nutzbaren Feature gebündelt; derselbe Toad-Eintrag kann mehrere aufeinanderfolgende Schritte inspirieren. Das ist kein 1:1-Port und keine Zusage, dass historische Toad-Funktionen in dessen aktueller Version unverändert existieren.

## Umsetzungsrahmen

Diese Regeln sind Teil jedes Tickets:

- Vor Beginn den aktuellen Code abgleichen; vorhandene Funktionen erweitern und keine zweite parallele Implementierung anlegen.
- Oberflächenfunktionen gelten grundsätzlich für macOS, Linux und Windows. Datenbankfunktionen erscheinen nur bei passender Capability. Der im Ticket begrenzte Providerumfang hat Vorrang vor allgemeinen Labels.
- Neue Backend-Aufrufe über `src/lib/db.ts` führen; TypeScript- und Rust-Typen synchron halten. Capability-/Provider-Metadaten erweitern, wenn eine bestehende Capability die neue Funktion nicht präzise ausdrückt.
- Für jeden Datenbankzugriff die effektive SSH-Verbindung verwenden. Fehler dürfen keinen direkten Verbindungs-Fallback auslösen.
- Datenbank-, Schema- und Verbindungskontext beim Start erfassen; verspätete Antworten nach Kontextwechsel nicht in einen anderen Arbeitsplatz übernehmen.
- Schreibabläufe müssen die vorhandene Transaktionsverwaltung respektieren. Eine UI-Sperre oder SQL-Regex allein ist kein belastbarer Lesemodus.
- Geheimnisse bleiben im Schlüsselbund. SQL und Ergebnisdaten nicht unbeabsichtigt in Diagnosepakete oder Profilexporte übernehmen. Datenexporte exportieren dagegen ausdrücklich den vom Nutzer gewählten Datenumfang.
- Kleine neue Komponenten folgen der bestehenden Struktur und der Ein-Komponente-pro-Datei-Regel. Keine manuelle Änderung von `routeTree.gen.ts`; die Repository-Regeln aus AGENTS.md gelten weiterhin.
- Die Akzeptanzkriterien jedes Tickets bilden die Abnahme. Parser, Serialisierung, Kontexttrennung und Datenänderungen brauchen passende Regressionstests; Datei-/Import-/Export-Roundtrips prüfen. Kleine Darstellungsänderungen können gezielt manuell geprüft werden. Je nach Änderung TypeScript-Prüfung, passende Bun-Tests und Rust-Checks aus AGENTS.md ausführen.

Für diese reine Backlog-Erstellung wurden keine Anwendungstests ausgeführt. Geprüft wurden Ticketanzahl, IDs, Quelldaten, Dateilinks und Abhängigkeiten.

## Alle Tickets

| ID | Feature | Prio | SP | Bereich | Benötigt |
|---|---|---|---:|---|---|
| [L8DB-PLAN-001](L8DB-PLAN-001-profile-exportieren.md) | Verbindungsprofile ohne Geheimnisse exportieren | P1 | 2 | Verbindungen | – |
| [L8DB-PLAN-002](L8DB-PLAN-002-profile-importieren.md) | Exportierte Verbindungsprofile importieren | P1 | 3 | Verbindungen | [L8DB-PLAN-001](L8DB-PLAN-001-profile-exportieren.md) |
| [L8DB-PLAN-003](L8DB-PLAN-003-verbindungsfavoriten.md) | Verbindungen als Favoriten markieren | P2 | 1 | Verbindungen | – |
| [L8DB-PLAN-004](L8DB-PLAN-004-verbindungsfarbe.md) | Verbindungsfarbe im Arbeitsplatz anzeigen | P1 | 2 | Verbindungen | – |
| [L8DB-PLAN-005](L8DB-PLAN-005-postgres-lesemodus.md) | PostgreSQL-Verbindungen im Lesemodus öffnen | P2 | 5 | Verbindungen | – |
| [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md) | SQL-Dateien in einem Query-Tab öffnen | P1 | 2 | Editor | – |
| [L8DB-PLAN-007](L8DB-PLAN-007-sql-datei-speichern.md) | Query-Tabs als SQL-Datei speichern | P1 | 2 | Editor | [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md) |
| [L8DB-PLAN-008](L8DB-PLAN-008-externe-dateiaenderung.md) | Extern geänderte SQL-Dateien erkennen | P2 | 3 | Editor | [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md), [L8DB-PLAN-007](L8DB-PLAN-007-sql-datei-speichern.md) |
| [L8DB-PLAN-009](L8DB-PLAN-009-sql-auswahl-ausfuehren.md) | Nur markiertes SQL ausführen | P1 | 2 | Editor | – |
| [L8DB-PLAN-010](L8DB-PLAN-010-sql-cursorstatement.md) | PostgreSQL-Statement unter dem Cursor ausführen | P1 | 3 | Editor | [L8DB-PLAN-009](L8DB-PLAN-009-sql-auswahl-ausfuehren.md) |
| [L8DB-PLAN-011](L8DB-PLAN-011-snippets-verwalten.md) | Eigene SQL-Snippets verwalten | P2 | 2 | Editor | – |
| [L8DB-PLAN-012](L8DB-PLAN-012-snippets-einfuegen.md) | SQL-Snippets mit Platzhaltern einfügen | P2 | 2 | Editor | [L8DB-PLAN-011](L8DB-PLAN-011-snippets-verwalten.md) |
| [L8DB-PLAN-013](L8DB-PLAN-013-formatter-dialekt.md) | SQL-Formatierung nach Provider auswählen | P1 | 3 | Formatierung | – |
| [L8DB-PLAN-014](L8DB-PLAN-014-formatter-optionen.md) | Einrückung und Keyword-Schreibweise konfigurieren | P2 | 2 | Formatierung | [L8DB-PLAN-013](L8DB-PLAN-013-formatter-dialekt.md) |
| [L8DB-PLAN-015](L8DB-PLAN-015-tabs-durchsuchen.md) | Text in offenen Query-Tabs suchen | P2 | 3 | Editor | – |
| [L8DB-PLAN-016](L8DB-PLAN-016-editor-lesezeichen.md) | Lesezeichen in SQL-Tabs setzen | P3 | 2 | Editor | – |
| [L8DB-PLAN-017](L8DB-PLAN-017-tastenhilfe.md) | Durchsuchbare Tastenkürzelhilfe anzeigen | P2 | 1 | Shell | – |
| [L8DB-PLAN-018](L8DB-PLAN-018-ergebnisse-sortieren.md) | Abfrageergebnisse lokal sortieren | P1 | 2 | Ergebnisse | – |
| [L8DB-PLAN-019](L8DB-PLAN-019-ergebnisse-filtern.md) | Abfrageergebnisse lokal filtern | P1 | 3 | Ergebnisse | [L8DB-PLAN-018](L8DB-PLAN-018-ergebnisse-sortieren.md) |
| [L8DB-PLAN-020](L8DB-PLAN-020-grid-textsuche.md) | Text in geladenen Grid-Zellen suchen | P1 | 2 | Grid | – |
| [L8DB-PLAN-021](L8DB-PLAN-021-spalten-fixieren.md) | Beliebige Datenspalten links fixieren | P2 | 2 | Grid | – |
| [L8DB-PLAN-022](L8DB-PLAN-022-grid-layoutprofile.md) | Benannte Tabellenlayouts speichern | P2 | 3 | Grid | [L8DB-PLAN-021](L8DB-PLAN-021-spalten-fixieren.md) |
| [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md) | Zellbereiche auswählen und als TSV kopieren | P1 | 3 | Grid | – |
| [L8DB-PLAN-024](L8DB-PLAN-024-auswahl-aggregieren.md) | Kennzahlen für markierte Zellen anzeigen | P2 | 2 | Grid | [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md) |
| [L8DB-PLAN-025](L8DB-PLAN-025-zellwert-popup-bearbeiten.md) | Große Text- und JSON-Werte im Popup bearbeiten | P2 | 3 | Grid | – |
| [L8DB-PLAN-026](L8DB-PLAN-026-fk-wertauswahl.md) | Fremdschlüsselwert über Referenztabelle auswählen | P2 | 3 | Grid | – |
| [L8DB-PLAN-027](L8DB-PLAN-027-tabellendaten-auto-refresh.md) | Tabellendaten im sichtbaren Tab automatisch aktualisieren | P2 | 2 | Grid | – |
| [L8DB-PLAN-028](L8DB-PLAN-028-insert-export.md) | Geladene Tabellenzeilen als INSERT-SQL exportieren | P1 | 3 | Export | – |
| [L8DB-PLAN-029](L8DB-PLAN-029-xlsx-export.md) | Geladene Ergebnisse als XLSX exportieren | P2 | 3 | Export | – |
| [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) | CSV-Export mit Vorschau konfigurieren | P1 | 3 | Export | – |
| [L8DB-PLAN-031](L8DB-PLAN-031-vollstaendiger-tabellenexport.md) | Gefilterte PostgreSQL-Tabelle vollständig exportieren | P2 | 5 | Export | [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) |
| [L8DB-PLAN-032](L8DB-PLAN-032-export-vorlagen.md) | CSV-Exportoptionen als Vorlage speichern | P3 | 2 | Export | [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) |
| [L8DB-PLAN-033](L8DB-PLAN-033-export-maskieren.md) | Gewählte Exportspalten maskieren | P2 | 3 | Export | [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) |
| [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md) | CSV-Dateien für den Import voranzeigen | P1 | 3 | Import | – |
| [L8DB-PLAN-035](L8DB-PLAN-035-csv-spaltenmapping.md) | CSV-Spalten einer PostgreSQL-Tabelle zuordnen | P1 | 3 | Import | [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md) |
| [L8DB-PLAN-036](L8DB-PLAN-036-csv-import-ausfuehren.md) | Kleinen CSV-Import atomar in PostgreSQL ausführen | P1 | 5 | Import | [L8DB-PLAN-035](L8DB-PLAN-035-csv-spaltenmapping.md) |
| [L8DB-PLAN-037](L8DB-PLAN-037-globale-objektsuche.md) | Objektsuche über alle Schemas vervollständigen | P1 | 3 | Objekte | – |
| [L8DB-PLAN-038](L8DB-PLAN-038-spaltensuche.md) | Spalten datenbankweit suchen | P2 | 3 | Objekte | – |
| [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) | PostgreSQL-Routinen und Views im Quelltext durchsuchen | P3 | 3 | Objekte | – |
| [L8DB-PLAN-040](L8DB-PLAN-040-objektfavoriten.md) | Häufig verwendete Tabellen und Views anheften | P2 | 2 | Objekte | – |
| [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md) | SQL vor dem Erstellen einer PostgreSQL-Tabelle anzeigen | P1 | 3 | DDL | – |
| [L8DB-PLAN-042](L8DB-PLAN-042-tabelle-als-vorlage.md) | PostgreSQL-Tabellenspalten als Vorlage übernehmen | P2 | 3 | DDL | [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md) |
| [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md) | Zwei Objektdefinitionen nebeneinander vergleichen | P2 | 3 | Vergleich | – |
| [L8DB-PLAN-044](L8DB-PLAN-044-schema-snapshot.md) | PostgreSQL-Tabellenmetadaten als Snapshot speichern | P3 | 3 | Vergleich | – |
| [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md) | Ausführungsplan mit Kontext speichern | P2 | 2 | Explain | – |
| [L8DB-PLAN-046](L8DB-PLAN-046-explain-laden.md) | Gespeicherten PostgreSQL-Plan offline öffnen | P2 | 2 | Explain | [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md) |
| [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md) | Zwei gespeicherte Pläne vergleichen | P3 | 3 | Explain | [L8DB-PLAN-046](L8DB-PLAN-046-explain-laden.md) |
| [L8DB-PLAN-048](L8DB-PLAN-048-blocking-sessions.md) | Blockierende PostgreSQL-Sitzungen verknüpft anzeigen | P1 | 3 | Sessions | – |
| [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md) | Sitzungsliste nach Nutzer, App und Status filtern | P2 | 2 | Sessions | – |
| [L8DB-PLAN-050](L8DB-PLAN-050-session-gruppierung.md) | Sitzungen nach Benutzer oder Anwendung gruppieren | P3 | 2 | Sessions | [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md) |
| [L8DB-PLAN-051](L8DB-PLAN-051-query-bibliothek-transfer.md) | Gespeicherte Queries importieren und exportieren | P2 | 3 | Bibliothek | – |
| [L8DB-PLAN-052](L8DB-PLAN-052-diagnosepaket.md) | Einsehbares Diagnosepaket lokal erstellen | P2 | 3 | Support | – |
| [L8DB-PLAN-053](L8DB-PLAN-053-benannte-workspaces.md) | Benannte Arbeitsplatzstände speichern und öffnen | P3 | 3 | Workspace | – |
| [L8DB-PLAN-054](L8DB-PLAN-054-query-builder-basics.md) | Einfache SELECT-Abfrage grafisch erstellen | P3 | 3 | Query Builder | – |
| [L8DB-PLAN-055](L8DB-PLAN-055-query-builder-fk-join.md) | Einen Fremdschlüssel-Join zum Query Builder hinzufügen | P3 | 3 | Query Builder | [L8DB-PLAN-054](L8DB-PLAN-054-query-builder-basics.md) |
| [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md) | Zwei kleine PostgreSQL-Tabellen per Primärschlüssel vergleichen | P3 | 5 | Vergleich | – |
| [L8DB-PLAN-057](L8DB-PLAN-057-datendifferenz-sql.md) | INSERT- und UPDATE-Skript aus Datenvergleich erzeugen | P3 | 3 | Vergleich | [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md), [L8DB-PLAN-028](L8DB-PLAN-028-insert-export.md) |
| [L8DB-PLAN-058](L8DB-PLAN-058-er-fokus.md) | ER-Diagramm auf eine Tabelle und ihre Nachbarn begrenzen | P2 | 3 | ER | – |
| [L8DB-PLAN-059](L8DB-PLAN-059-skript-im-editor.md) | SQL-Skript aus dem Query-Tab mit Einzelergebnissen ausführen | P2 | 3 | Editor | – |
| [L8DB-PLAN-060](L8DB-PLAN-060-query-bindparameter.md) | PostgreSQL-Abfragen mit Bind-Parametern ausführen | P2 | 5 | Editor | – |
| [L8DB-PLAN-061](L8DB-PLAN-061-spaltennamen-kopieren.md) | Sichtbare Spaltennamen kopieren | P2 | 1 | Grid | – |
| [L8DB-PLAN-062](L8DB-PLAN-062-fenstertitel-kontext.md) | Verbindung und Datenbank im Fenstertitel anzeigen | P2 | 1 | Shell | – |
| [L8DB-PLAN-063](L8DB-PLAN-063-used-by-analyse.md) | Used-By-Tab für Tabellen und Views mit Abhängigkeitsanalyse | P2 | 5 | Objekte | [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) |
| [L8DB-PLAN-064](L8DB-PLAN-064-synonyme-browsen.md) | Synonyme browsen und zum Zielobjekt auflösen | P3 | 3 | Objekte | – |
| [L8DB-PLAN-065](L8DB-PLAN-065-scheduler-jobs.md) | Scheduler-Jobs anzeigen und steuern | P3 | 5 | Sessions | – |
| [L8DB-PLAN-066](L8DB-PLAN-066-regex-suche-helper.md) | Regex-Suche mit Helper und Live-Trefferzählung | P2 | 2 | Editor | [L8DB-PLAN-020](L8DB-PLAN-020-grid-textsuche.md), [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) |
| [L8DB-PLAN-067](L8DB-PLAN-067-objekt-schema-kopieren.md) | Objekte vergleichen und in anderes Schema erstellen | P2 | 5 | Vergleich | [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md), [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md) |
| [L8DB-PLAN-068](L8DB-PLAN-068-plsql-debugger.md) | PL/SQL-Debugger als schlanker Einstieg | P3 | 5 | Editor | [L8DB-PLAN-071](L8DB-PLAN-071-objekte-kompilieren.md) |
| [L8DB-PLAN-069](L8DB-PLAN-069-dbms-log-output.md) | DBMS- und Log-Outputs im Query-Arbeitsplatz anzeigen | P3 | 3 | Editor | – |
| [L8DB-PLAN-070](L8DB-PLAN-070-prozeduren.md) | Prozeduren als eigene Objektfamilie | P2 | 3 | Objekte | – |
| [L8DB-PLAN-071](L8DB-PLAN-071-objekte-kompilieren.md) | Funktionen, Prozeduren und Packages per Kontextmenü kompilieren | P2 | 2 | DDL | [L8DB-PLAN-070](L8DB-PLAN-070-prozeduren.md) |
| [L8DB-PLAN-072](L8DB-PLAN-072-drop-rename-alter-audit.md) | Tabellen und Views droppen, umbenennen, ändern und auditieren | P2 | 3 | DDL | [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md) |
| [L8DB-PLAN-073](L8DB-PLAN-073-performance-test.md) | Performance-Test für Tabellen und Views | P3 | 3 | Explain | [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md), [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md) |
| [L8DB-PLAN-074](L8DB-PLAN-074-migrationsskripte.md) | Migrationsskripte automatisch erstellen | P3 | 5 | Vergleich | [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md), [L8DB-PLAN-044](L8DB-PLAN-044-schema-snapshot.md), [L8DB-PLAN-057](L8DB-PLAN-057-datendifferenz-sql.md) |
| [L8DB-PLAN-075](L8DB-PLAN-075-zeile-duplizieren-edit.md) | Zeile duplizieren im Edit-State mit änderbarem PK | P2 | 2 | Grid | – |
