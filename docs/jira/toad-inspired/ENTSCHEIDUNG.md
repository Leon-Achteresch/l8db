# Auswahlentscheidung über den Toad-Katalog

Alle 75 Kategorien des 826-Punkte-Audits wurden für die Backlog-Auswahl eingeordnet. Die Tabelle klassifiziert Kategorien, nicht jeden einzelnen Schalter als implementiert oder fehlend. Nur die in den Tickets genannten Teile sind zur Umsetzung empfohlen. Ein leerer Ticketbezug heißt: aus dieser Kategorie wurde kein eigener Umsetzungsschritt abgeleitet.

Die Auswahl priorisiert wiederkehrenden Nutzen, vorhandene Code-Anknüpfungspunkte, begrenzten Implementierungsumfang und Übertragbarkeit auf einen Desktop-Client mit mehreren Datenbankfamilien. Sie ist eine Produktentscheidung aus dem Codezustand, keine durch Nutzungsmetriken validierte Roadmap. P3-Tickets sind spätere Optionen.

Quellenstatus D26, H und M25 stammen unverändert aus dem [Audit](../../toad-for-oracle-feature-audit.de.md#kennzeichnung). Ein historischer Toad-Nachweis schwächt nicht den beschriebenen l8db-Nutzen, darf aber nicht als aktuelle Toad-Produktzusage gelesen werden. Übertragungen sind im Ticketumfang ausdrücklich benannt, etwa CSV-Vorlagen statt Data-Pump-Parameter oder PostgreSQL statt Oracle.

## Codebasis der Entscheidung

Die folgenden Dateien waren besonders relevant:

- [src/lib/connections.ts](../../../src/lib/connections.ts)
- [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)
- [src/lib/split-view.ts](../../../src/lib/split-view.ts)
- [src/lib/query-history.ts](../../../src/lib/query-history.ts)
- [src/lib/saved-queries.ts](../../../src/lib/saved-queries.ts)
- [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)
- [src/lib/monaco.ts](../../../src/lib/monaco.ts)
- [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)
- [src/features/query/query-result-table.tsx](../../../src/features/query/query-result-table.tsx)
- [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx)
- [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx)
- [src/features/import/import-view.tsx](../../../src/features/import/import-view.tsx)
- [src/features/shell/app-header-search.tsx](../../../src/features/shell/app-header-search.tsx)
- [src/features/er-diagram/er-diagram-view.tsx](../../../src/features/er-diagram/er-diagram-view.tsx)
- [src/features/sessions/sessions-view.tsx](../../../src/features/sessions/sessions-view.tsx)
- [src/features/tables/create-table-view.tsx](../../../src/features/tables/create-table-view.tsx)
- [src-tauri/src/db/provider.rs](../../../src-tauri/src/db/provider.rs)
- [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)
- [docs/providers.md](../../../docs/providers.md)

## Bewertung je Kategorie

| Kategorie | Entscheidung und Grenze | Zugeordnete Tickets |
|---|---|---|
| [01. Verbindungen und Anmeldung](../../toad-for-oracle-feature-audit.de.md#g01) | Profilgrundlagen und Commit/Rollback bestehen. Automatisches Anmelden und parallele aktive Verbindungen vorerst zurückstellen; der aktuelle Wechselablauf schützt offene Transaktionen. | – |
| [02. Oracle-Verbindungsmethoden und Sicherheit](../../toad-for-oracle-feature-audit.de.md#g02) | SSL/SSH und Treiberverwaltung bestehen. Oracle-Clientlosigkeit oder alternative Oracle Homes erfordern einen separaten Treiberfokus. | – |
| [03. Authentifizierungsvarianten](../../toad-for-oracle-feature-audit.de.md#g03) | Enterprise-Authentifizierung nur nach konkretem Kundenbedarf und Prüfung des jeweiligen Treibers. | – |
| [04. Verbindungen übertragen](../../toad-for-oracle-feature-audit.de.md#g04) | Profiltransfer auswählen; passworttragende Archive wegen zusätzlicher Komplexität vorerst auslassen. | [L8DB-PLAN-001](L8DB-PLAN-001-profile-exportieren.md), [L8DB-PLAN-002](L8DB-PLAN-002-profile-importieren.md) |
| [05. Verbindungen organisieren](../../toad-for-oracle-feature-audit.de.md#g05) | Farbe und Favoriten ergänzen. Tags und Suche bestehen; mehrstufige Bäume oder frei konfigurierbare Login-Tabellen sind derzeit weniger wichtig. | [L8DB-PLAN-003](L8DB-PLAN-003-verbindungsfavoriten.md), [L8DB-PLAN-004](L8DB-PLAN-004-verbindungsfarbe.md) |
| [06. Editor: Dateien und Navigation](../../toad-for-oracle-feature-audit.de.md#g06) | Dateiabläufe und Lesezeichen ergänzen. Tabs, persistierte SQL-Texte und Kontextauswahl bestehen bereits. | [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md), [L8DB-PLAN-007](L8DB-PLAN-007-sql-datei-speichern.md), [L8DB-PLAN-015](L8DB-PLAN-015-tabs-durchsuchen.md), [L8DB-PLAN-016](L8DB-PLAN-016-editor-lesezeichen.md) |
| [07. Editor: Suchen und Ersetzen](../../toad-for-oracle-feature-audit.de.md#g07) | Monaco deckt die grundlegenden Suchen-/Ersetzen-Aktionen ab. Separate Makro-Engine und parallele Dateisuche zurückstellen. | – |
| [08. Codevorlagen und Einfügehilfen](../../toad-for-oracle-feature-audit.de.md#g08) | Benutzerdefinierte Vorlagen auswählen und über die vorhandene Completion integrieren. | [L8DB-PLAN-012](L8DB-PLAN-012-snippets-einfuegen.md) |
| [09. Snippets und Codevervollständigung](../../toad-for-oracle-feature-audit.de.md#g09) | Snippet-Bibliothek ergänzen; kein separater Drag-and-drop-Workflow nötig. | [L8DB-PLAN-011](L8DB-PLAN-011-snippets-verwalten.md) |
| [10. Code bearbeiten und aufbereiten](../../toad-for-oracle-feature-audit.de.md#g10) | Formatierung an Provider und Nutzeroptionen anpassen. Tiefe Code-Transformation und Komplexitätsmetriken vorerst auslassen. | [L8DB-PLAN-010](L8DB-PLAN-010-sql-cursorstatement.md), [L8DB-PLAN-013](L8DB-PLAN-013-formatter-dialekt.md), [L8DB-PLAN-014](L8DB-PLAN-014-formatter-optionen.md) |
| [11. SQL ausführen und Skripte verwalten](../../toad-for-oracle-feature-audit.de.md#g11) | Auswahl, Cursorstatement und explizite Skriptausführung ergänzen. Externe Oracle Runner und Automationsdesigner zurückstellen. | [L8DB-PLAN-009](L8DB-PLAN-009-sql-auswahl-ausfuehren.md), [L8DB-PLAN-010](L8DB-PLAN-010-sql-cursorstatement.md), [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md), [L8DB-PLAN-059](L8DB-PLAN-059-skript-im-editor.md) |
| [12. SQL-Historie und PL/SQL-Arbeit](../../toad-for-oracle-feature-audit.de.md#g12) | SQL-Verlauf und gespeicherte Queries bestehen. Transfer ergänzen; PL/SQL-spezifische Codegenerierung zurückstellen. | [L8DB-PLAN-051](L8DB-PLAN-051-query-bibliothek-transfer.md) |
| [13. Query Builder](../../toad-for-oracle-feature-audit.de.md#g13) | Kleinen SELECT-Builder und einen FK-Join auswählen. Bidirektionaler SQL/Diagramm-Parser, Subqueries und vollständiger Query Designer bleiben außerhalb. | [L8DB-PLAN-054](L8DB-PLAN-054-query-builder-basics.md), [L8DB-PLAN-055](L8DB-PLAN-055-query-builder-fk-join.md) |
| [14. PL/SQL-Debugger](../../toad-for-oracle-feature-audit.de.md#g14) | PL/SQL-Debugger ist ein eigenständiger großer Providerbereich; derzeit kein Ticket. | – |
| [15. Debugger: Haltepunkte und Zustandsinspektion](../../toad-for-oracle-feature-audit.de.md#g15) | Watches, Call Stack und Debuggerabhängigkeiten setzen einen nicht priorisierten Debugger voraus. | [L8DB-PLAN-059](L8DB-PLAN-059-skript-im-editor.md) |
| [16. Haltepunkte und DBMS Output](../../toad-for-oracle-feature-audit.de.md#g16) | Oracle DBMS Output und Breakpoints nachrangig gegenüber allgemeinen SQL-Abläufen. | – |
| [17. PL/SQL-Profiling](../../toad-for-oracle-feature-audit.de.md#g17) | Oracle-Profiling ist stark paket- und berechtigungsabhängig; zunächst den vorhandenen EXPLAIN-Workflow vertiefen. | – |
| [18. Dateivergleich und Merge](../../toad-for-oracle-feature-audit.de.md#g18) | Schreibgeschützten Text-Diff von Objektdefinitionen auswählen. VCS-Revisionen und Drei-Wege-Merge zurückstellen. | [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md) |
| [19. Schema Browser: Navigation](../../toad-for-oracle-feature-audit.de.md#g19) | Schema-/Objektbrowser und zahlreiche Detailansichten bestehen. Kein breiter Oracle-Katalog-Port. | [L8DB-PLAN-027](L8DB-PLAN-027-tabellendaten-auto-refresh.md) |
| [20. Schema Browser: Filter](../../toad-for-oracle-feature-audit.de.md#g20) | Schnellfilter im Browser bestehen. Portable Filterdateien und Regelverwaltung erst bei regelmäßigem Bedarf. | – |
| [21. Objekte finden und beschreiben](../../toad-for-oracle-feature-audit.de.md#g21) | Objekt-, Spalten- und Quelltextsuche auswählen; keine vollständige Suchmaschine über Dateninhalte. | [L8DB-PLAN-037](L8DB-PLAN-037-globale-objektsuche.md), [L8DB-PLAN-038](L8DB-PLAN-038-spaltensuche.md), [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) |
| [22. Objekte erstellen und ändern](../../toad-for-oracle-feature-audit.de.md#g22) | DDL-Vorschau und schmalen Tabellen-Vorlagenablauf auswählen. CRUD-Dialoge existieren bereits für mehrere Objekte. | [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md), [L8DB-PLAN-042](L8DB-PLAN-042-tabelle-als-vorlage.md) |
| [23. Dokumentierte Oracle-Objektfamilien](../../toad-for-oracle-feature-audit.de.md#g23) | Relevante Objektfamilien sind providerabhängig vorhanden. Oracle-Spezialobjekte nicht allein wegen der Toad-Liste aufnehmen. | – |
| [24. Fremdschlüssel und relationale Navigation](../../toad-for-oracle-feature-audit.de.md#g24) | FK-Navigation und Vorschau bestehen. Wertepicker ergänzen; programmierbares Lookup-SQL zurückstellen. | [L8DB-PLAN-026](L8DB-PLAN-026-fk-wertauswahl.md) |
| [25. Grid: Darstellung, Suche und Filter](../../toad-for-oracle-feature-audit.de.md#g25) | Grid-Analyse vertiefen. Sortierung, Zeilennummern, serverseitige Tabellenfilter und Spaltenausblenden nicht erneut bauen. | [L8DB-PLAN-018](L8DB-PLAN-018-ergebnisse-sortieren.md), [L8DB-PLAN-019](L8DB-PLAN-019-ergebnisse-filtern.md), [L8DB-PLAN-020](L8DB-PLAN-020-grid-textsuche.md), [L8DB-PLAN-021](L8DB-PLAN-021-spalten-fixieren.md), [L8DB-PLAN-061](L8DB-PLAN-061-spaltennamen-kopieren.md) |
| [26. Grid: Daten ändern und rechnen](../../toad-for-oracle-feature-audit.de.md#g26) | Zeilenbearbeitung und Transaktionen bestehen. Popup-Bearbeitung und Auswahlaggregate ergänzen. | [L8DB-PLAN-024](L8DB-PLAN-024-auswahl-aggregieren.md), [L8DB-PLAN-025](L8DB-PLAN-025-zellwert-popup-bearbeiten.md) |
| [27. Editierbare Abfragen und Datenkopie](../../toad-for-oracle-feature-audit.de.md#g27) | Datenkopie zwischen Schemas und editierbare beliebige SELECTs benötigen eigene Identitäts-/Transaktionskonzepte; vorerst zurückgestellt. | – |
| [28. Datenvergleich und Synchronisierung](../../toad-for-oracle-feature-audit.de.md#g28) | Kleinen lesenden Datenvergleich und Skriptgenerierung auswählen. DB Links und automatische Synchronisierung auslassen. | [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md), [L8DB-PLAN-057](L8DB-PLAN-057-datendifferenz-sql.md) |
| [29. Datenvergleich: Schlüssel und Differenzen](../../toad-for-oracle-feature-audit.de.md#g29) | Nur eindeutige Primärschlüssel als erste Vergleichsbasis; keine heuristische Zuordnung ohne Schlüssel. | [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md) |
| [30. Objekt- und Schemavergleich](../../toad-for-oracle-feature-audit.de.md#g30) | Definition-Diff und Tabellenmetadaten-Snapshot auswählen. Vollständiges Schema-Diff und Migrationsplanung später gesondert bewerten. | [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md), [L8DB-PLAN-044](L8DB-PLAN-044-schema-snapshot.md) |
| [31. Datenbankvergleich und Rebuild](../../toad-for-oracle-feature-audit.de.md#g31) | Rebuild, Voll-Datenbankvergleich und automatische Schemaänderungen sind für den aktuellen Clientumfang zu groß. | – |
| [32. Exportformate und Exportwege](../../toad-for-oracle-feature-audit.de.md#g32) | INSERT/XLSX und bessere Exportabläufe auswählen; vorhandene CSV/JSON- und ER-Exporte weiterverwenden. Oracle Data Pump zurückstellen. | [L8DB-PLAN-028](L8DB-PLAN-028-insert-export.md), [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md), [L8DB-PLAN-031](L8DB-PLAN-031-vollstaendiger-tabellenexport.md), [L8DB-PLAN-032](L8DB-PLAN-032-export-vorlagen.md), [L8DB-PLAN-033](L8DB-PLAN-033-export-maskieren.md), [L8DB-PLAN-058](L8DB-PLAN-058-er-fokus.md) |
| [33. Excel-Export: kleine Optionen](../../toad-for-oracle-feature-audit.de.md#g33) | Keine direkte Excel-Instanzsteuerung: plattformübergreifender Dateiexport genügt zunächst. | – |
| [34. Excel-Dateidetails](../../toad-for-oracle-feature-audit.de.md#g34) | XLSX auswählen; das alte XLS-Format nicht zusätzlich pflegen. | [L8DB-PLAN-029](L8DB-PLAN-029-xlsx-export.md) |
| [35. Exportüberschriften](../../toad-for-oracle-feature-audit.de.md#g35) | Headeroption in den gemeinsamen CSV-Export aufnehmen. | [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md) |
| [36. Arbeitsblattnamen](../../toad-for-oracle-feature-audit.de.md#g36) | Blattname als kleine Option im XLSX-Ticket bündeln. | [L8DB-PLAN-029](L8DB-PLAN-029-xlsx-export.md) |
| [37. Export: Kompression und Dateiverhalten](../../toad-for-oracle-feature-audit.de.md#g37) | Zeilenenden und lokale Mehrspaltensortierung auswählen. Kompression, Formelberechnung und Mehrzellen-Paste später. | [L8DB-PLAN-018](L8DB-PLAN-018-ergebnisse-sortieren.md), [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md), [L8DB-PLAN-031](L8DB-PLAN-031-vollstaendiger-tabellenexport.md) |
| [38. Tabellenimport](../../toad-for-oracle-feature-audit.de.md#g38) | Importvorschau, Mapping und atomaren Import auswählen; Excel-Import und viele Importmodi später. | [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md), [L8DB-PLAN-035](L8DB-PLAN-035-csv-spaltenmapping.md), [L8DB-PLAN-036](L8DB-PLAN-036-csv-import-ausfuehren.md) |
| [39. Textimport und SQL*Loader](../../toad-for-oracle-feature-audit.de.md#g39) | CSV/TSV auswählen; Oracle SQL*Loader ist kein allgemeiner l8db-Workflow. | [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md) |
| [40. Testdaten und Codequalität](../../toad-for-oracle-feature-audit.de.md#g40) | Grundlegender SQL-Lint existiert. Vollständige Code-Analysis-Regelengine und Ratings sind für den heutigen Umfang nicht vorrangig. | – |
| [41. Testdatengenerator](../../toad-for-oracle-feature-audit.de.md#g41) | Realitätsnaher Testdatengenerator später nach Bedarf; Constraints und Referenzen machen ihn zu einem eigenen größeren Thema. | – |
| [42. utPLSQL-Unit-Tests](../../toad-for-oracle-feature-audit.de.md#g42) | Kein grafischer utPLSQL-Testmanager ohne bestätigten Oracle-Entwicklungsschwerpunkt. | – |
| [43. DBA: Monitoring, Statistiken und Diagnose](../../toad-for-oracle-feature-audit.de.md#g43) | Bestehenden Sessions-/Locks-Bereich vertiefen. AWR, StatsPack, SGA und Oracle-Advisories nicht in einen allgemeinen Client kopieren. | [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md) |
| [44. DBA: Health Checks und Speicherverwaltung](../../toad-for-oracle-feature-audit.de.md#g44) | Health-Check-Engine, ASM, Speicherprognosen und LogMiner gehören zu einem separaten DBA-Produktbereich. | – |
| [45. Database Browser: Instanzübersicht](../../toad-for-oracle-feature-audit.de.md#g45) | Vorhandene Übersichten und Sessions nutzen; gezielte Filter ergänzen. Kein dauerhaftes Monitoring-Repository. | [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md) |
| [46. Oracle 23ai und neuere Objektdetails](../../toad-for-oracle-feature-audit.de.md#g46) | Oracle-Spezialfunktionen nicht pauschal übernehmen. VECTOR-Datentypen können später als eigener Datenansicht-/Treiberbedarf geprüft werden. | – |
| [47. Automatisierung: Abläufe und Bedingungen](../../toad-for-oracle-feature-audit.de.md#g47) | Automationsdesigner, Verzweigungen und E-Mail-Aktionen vorerst auslassen; zunächst manuelle Abläufe zuverlässig machen. | – |
| [48. Automatisierung: Verbindungen und Unterabläufe](../../toad-for-oracle-feature-audit.de.md#g48) | Keine automatische Skriptausführung über mehrere Datenbanken; erhöht Komplexität von Kontext und Fehlerbehandlung deutlich. | – |
| [49. Automatisierung: Daten- und Datei-Iteratoren](../../toad-for-oracle-feature-audit.de.md#g49) | Iterator-Engine erst nach Entscheidung für eine Automationsplattform. | – |
| [50. Automatisierung: Zeitplanung und Skriptsammlungen](../../toad-for-oracle-feature-audit.de.md#g50) | Keine Windows-spezifische Schedulerintegration für einen plattformübergreifenden Client; CLI-Scope separat entscheiden. | – |
| [51. Script Manager und Batch Jobs](../../toad-for-oracle-feature-audit.de.md#g51) | Datei- und Editorabläufe decken den unmittelbaren Skriptbedarf. Oracle Scheduler und Skriptsammlungs-Runner zurückstellen. | – |
| [52. Sensitive Data Protection: Erkennung und Schutz](../../toad-for-oracle-feature-audit.de.md#g52) | Explizite Exportmaskierung auswählen. Automatische Erkennung, Auditing und Verschlüsselungsverwaltung nicht als Compliance-Suite nachbauen. | – |
| [53. Sensitive Data Protection: Scan-Optionen](../../toad-for-oracle-feature-audit.de.md#g53) | Keine Hintergrundscans, Scan-Threadverwaltung oder zeitgesteuerten Berichte ohne priorisiertes Schutzmodul. | – |
| [54. Sensitive Data Protection: Standardrichtlinien](../../toad-for-oracle-feature-audit.de.md#g54) | Oracle-Richtlinienverwaltung und automatische Schutzpolicies derzeit nicht Teil des Zielumfangs. | – |
| [55. Team Coding und Versionsverwaltung](../../toad-for-oracle-feature-audit.de.md#g55) | SQL-Dateien im vorhandenen Git-Arbeitsverzeichnis nutzen. Kein zweiter Git-/SVN-/Legacy-VCS-Client. | – |
| [56. Git-Integration: Detailoptionen](../../toad-for-oracle-feature-audit.de.md#g56) | Git-Konfiguration und Repository-Browser zunächst der IDE beziehungsweise dem Git-Client überlassen. | – |
| [57. Git-Integration: Repository-Synchronisation](../../toad-for-oracle-feature-audit.de.md#g57) | Clone/Pull/Push innerhalb l8db haben geringeren unmittelbaren Nutzen als ein guter Datei-Workflow. | – |
| [58. Berichte und Druck](../../toad-for-oracle-feature-audit.de.md#g58) | CSV/XLSX und vorhandener ER-Export decken den unmittelbaren Austauschbedarf; kein eigener Berichtsdesigner. | – |
| [59. Berichtsvorlagen](../../toad-for-oracle-feature-audit.de.md#g59) | Druck- und Berichtsvorlagen zurückstellen. | – |
| [60. Oberfläche: Menüs und Tastatur](../../toad-for-oracle-feature-audit.de.md#g60) | Zunächst tatsächliche Tastenkürzel dokumentieren; freie Menü- und Toolbar-Designer erhöhen Konfigurationsaufwand. | – |
| [61. Oberfläche: Einstellungen und Layout](../../toad-for-oracle-feature-audit.de.md#g61) | Keine frei editierbaren Symbolleisten. Sichere Migration neuer persistierter Zustände gehört zur jeweiligen Implementierung. | – |
| [62. Barrierearme Tastaturbedienung](../../toad-for-oracle-feature-audit.de.md#g62) | Tastaturzugänglichkeit und verständliche Hilfe sind sinnvoll; keine Toad-spezifischen Fokusoptionen kopieren. | [L8DB-PLAN-017](L8DB-PLAN-017-tastenhilfe.md) |
| [63. 2026 R2: KI und kontextbezogene Assistenz](../../toad-for-oracle-feature-audit.de.md#g63) | KI-Chat, Copilot und MCP zurückstellen, bis Datenfreigabe, Modellanbindung und konkreter Arbeitsablauf geklärt sind. Kein unaufgeforderter KI-Scope. | – |
| [64. 2026 R2: kleine Bedienfunktionen](../../toad-for-oracle-feature-audit.de.md#g64) | Grid-Suche und Fenstertitel auswählen. TNS- und LogMiner-Details nur mit gesondertem Oracle-Fokus. | [L8DB-PLAN-020](L8DB-PLAN-020-grid-textsuche.md), [L8DB-PLAN-062](L8DB-PLAN-062-fenstertitel-kontext.md) |
| [65. 2026 R1: zusätzliche Detailfunktionen](../../toad-for-oracle-feature-audit.de.md#g65) | Blocking-Anzeige, Gruppierung, Layouts, Dateiänderungen und Objektfavoriten auswählen. Grundlegende Tab-Persistenz besteht bereits. | [L8DB-PLAN-008](L8DB-PLAN-008-externe-dateiaenderung.md), [L8DB-PLAN-022](L8DB-PLAN-022-grid-layoutprofile.md), [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md), [L8DB-PLAN-040](L8DB-PLAN-040-objektfavoriten.md), [L8DB-PLAN-048](L8DB-PLAN-048-blocking-sessions.md), [L8DB-PLAN-050](L8DB-PLAN-050-session-gruppierung.md) |
| [66. Zusatzprodukt SQL Optimizer: Optimierung](../../toad-for-oracle-feature-audit.de.md#g66) | Kein automatischer SQL-Optimizer, hypothetischer Indexberater oder automatische Planfixierung. Messbare Pläne zuerst vergleichbar machen. | [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md) |
| [67. Zusatzprodukt SQL Optimizer: Analysewerkzeuge](../../toad-for-oracle-feature-audit.de.md#g67) | Planvergleich und einfache Bind-Parameter als allgemeine Clientfunktionen übertragen; kein kompletter Optimizer-Arbeitsbereich. | [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md), [L8DB-PLAN-060](L8DB-PLAN-060-query-bindparameter.md) |
| [68. Zusatzprodukt Code Tester: Testverwaltung](../../toad-for-oracle-feature-audit.de.md#g68) | Code Tester ist ein eigenständiges Produkt; GUI-Testsuiten und Repositoryverwaltung nicht übernehmen. | – |
| [69. Zusatzprodukt Code Tester: Testpflege](../../toad-for-oracle-feature-audit.de.md#g69) | Code-Evolution-/Test-Debugging-Funktionen setzen eine nicht priorisierte Testplattform voraus. | – |
| [70. Zusatzprodukt Benchmark Factory](../../toad-for-oracle-feature-audit.de.md#g70) | Lastgeneratoren, Workload-Capture und verteilte Agenten passen nicht in den derzeitigen Desktop-Clientumfang. | – |
| [71. Zusatzprodukt Spotlight on Oracle](../../toad-for-oracle-feature-audit.de.md#g71) | Keine Spotlight-Kopie mit Alarmierung und OS-Diagnose; Sessions und EXPLAIN bieten den passenden Einstieg. | – |
| [72. Zusatzprodukt Spotlight: Editionsoptionen](../../toad-for-oracle-feature-audit.de.md#g72) | RAC, Data Guard und Exadata setzen einen spezialisierten Oracle-Betriebsschwerpunkt voraus. | – |
| [73. Zusatzprodukt Toad Data Modeler](../../toad-for-oracle-feature-audit.de.md#g73) | ER-Diagramm und mehrere Provider bestehen bereits. Kein vollständiger logischer/physischer Datenmodellierer mit Modellversionen. | – |
| [74. Verbindungsdialog: zusätzliche Detailoptionen](../../toad-for-oracle-feature-audit.de.md#g74) | Profilbezogenen Lesemodus auswählen; Grundverbindung und getrenntes Speichern bestehen. TNS/LDAP und Login-Automationen später bei echtem Oracle-Bedarf. | [L8DB-PLAN-005](L8DB-PLAN-005-postgres-lesemodus.md) |
| [75. Explain Plan und integrierte Hilfe](../../toad-for-oracle-feature-audit.de.md#g75) | EXPLAIN-Speicherung, Hilfe, Diagnosepaket und benannte Workspaces auswählen. EXPLAIN-Grundansicht besteht bereits. | [L8DB-PLAN-017](L8DB-PLAN-017-tastenhilfe.md), [L8DB-PLAN-037](L8DB-PLAN-037-globale-objektsuche.md), [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md), [L8DB-PLAN-046](L8DB-PLAN-046-explain-laden.md), [L8DB-PLAN-052](L8DB-PLAN-052-diagnosepaket.md), [L8DB-PLAN-053](L8DB-PLAN-053-benannte-workspaces.md) |

Zur [priorisierten Ticketübersicht](README.md).
