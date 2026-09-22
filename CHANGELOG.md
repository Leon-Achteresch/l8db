# Changelog

Alle veröffentlichten Änderungen dieser App, automatisch aus der Git-Historie erzeugt.
Nicht von Hand bearbeiten: `bun run changelog` regeneriert diese Datei.

## [0.6.130] - 2026-09-22

### Fixes
- require Apple signing and notarization for macOS (#126)

## [0.6.128] - 2026-09-21

### Features
- refine tabs, filters, and navigation
- add onboarding and easy mode
- harden transfers and compare table snapshots

### Fixes
- make browser smoke and SSH key auth reliable
- stabilize integration health checks

## [0.6.121] - 2026-09-21

### Fixes
- use editable documents with toml_edit 0.25

## [0.6.101] - 2026-09-21

- Keine Änderungen.

## [0.6.99] - 2026-09-21

### Features
- enforce shared policies and durable background rollouts

### Weitere Änderungen
- Strengthen database release safety and customer rollout checks
- Redesign database versioning as a right sidebar panel
- Add database Git versioning and customer release deployments

## [0.6.89] - 2026-09-19

### Features
- add definition diff editing, apply workflow, and compare tab persistence
- add object grants support and refactor debugger into components
- add database debugging workflow
- Proxy-User per durchsuchbarer Auswahl (Benutzer/Rollen/Logins je DB), keine veralteten Zeilen nach Identitätswechsel, präzise Postgres-Verbindungsfehler
- Datenbank als Proxy-User ansehen (Postgres SET ROLE/RLS, SQL Server EXECUTE AS, Oracle Proxy-Anmeldung)
- Master pro Bereich frei wählbar (Ketten bis 4 Ebenen, ein Master mit mehreren Details), Pfeile sitzen auf der gemeinsamen Kante von Master und Detail
- add context menu row highlighting
- Dashboard-Tool zum Erstellen und Bearbeiten von Dashboards über den MCP
- Dashboard auch im Production-Build in der Sidebar anzeigen
- MongoDB- und Redis-Verbindungen über den MCP freigeben

### Fixes
- address CodeRabbit review on debugger, MCP MongoDB checks and proxy users
- Cmd+C kopiert die aktive Zelle auch, wenn der Fokus auf dem umgebenden Tab-Panel liegt

### Änderungen
- simplify header styling and layout
- simplify navigation logic and remove unused components

## [0.6.71] - 2026-09-19

### Features
- Verbindungsauswahl nutzt Gruppen-Layout und Karten des Verbindungsmanagers mit Checkbox statt Verwaltungsaktionen
- Verbindungen nach Server/Host-Regeln gruppiert wie im Verbindungsmanager
- Spalten verknüpfter Tabellen (auch über zwei Schritte und rückwärts) direkt wählbar, Verknüpfungen werden automatisch ergänzt und entfernt
- Chart-Erstellung als einfaches Einseiten-Formular, Expertenoptionen hinter Erweitert und ⋯-Menüs
- FK-Vorschau-Einstellungen und Spaltenbreiten-Anpassungen
- Tab-Titel per Tokenizer aus komplexen Skripten ableiten (CTEs, Subqueries, Blöcke, Multi-Statement)
- erstes Zielschema automatisch wählen und Editor-Öffnen gegen fehlgeschlagenen Verbindungswechsel absichern
- Panel schließt automatisch, sobald keine Transaktion mehr offen ist
- Query-Tabs zeigen automatisch einen kurzen Titel aus dem SQL statt „Query n“
- Zielschema-Liste folgt der gewählten Zielverbindung und deren zugewiesenen Schemas
- Zielschema als Sidebar-Select und nach Verbindungswechsel als aktives Schema setzen
- DDL in Query-Editor der gewählten Zielverbindung öffnen statt direkt auszuführen
- Strg+Klick auf END/END IF springt zum passenden BEGIN/IF in PL/SQL
- Objekte, Prozeduren und Packages in anderem Schema erstellen
- Shell-Syntax wie db.coll.aggregate([...]) mit ISODate im Query-Editor ausführen
- Objekte und Arrays in Zellen als Inhalt statt {} Object anzeigen
- Objekte per Kontextmenü in anderem Schema erstellen
- Suche pro Objekt-Tab und Connection merken

### Fixes
- MATERIALIZED-Spalten, Nested-Spalten, 64-Bit-Ints und Typ-Badges korrekt; Performance-Tab misst echte Laufzeit; bigdata-Seed für Browser-Lab
- globale Einstellung 'An Spaltentitel anpassen' setzt Mindestbreite auch bei gespeicherten Spaltenbreiten durch
- ungenutzte Imports entfernt
- DDL-Vorschau scrollt bei langen Skripten statt den Dialog zu sprengen
- Zielschema-Auswahl nutzt komplette Schemaliste statt gefilterter Sidebar-Schemas
- Strg+C blockiert natives Kopieren nicht mehr app-weit und kopiert Mehrfachauswahl wieder als TSV

### Performance
- Keychain-Secrets beim Start parallel statt sequenziell laden
- Seite 1 zuerst laden, Zeilenanzahl erst danach abfragen

### Änderungen
- große Dateien und Mehrfach-Komponenten in fokussierte Module aufgeteilt (max. 300 Zeilen, eine Komponente pro Datei)
- Verbindungs-Dropdown der Sidebar als ConnectionPicker extrahiert und im Schema-Copy-Dialog verwendet

### Weitere Änderungen
- Type(scope): Beschreibung

## [0.6.34] - 2026-09-18

### Features
- Kontextmenü für Packages in der Sidebar mit Kompilieren, Aufruf-Vorlage, Namen kopieren und DROP PACKAGE/BODY
- Kompilieren meldet gebrochene Aufrufer und markiert sie im Editor
- Prüfen von Views, Funktionen, Prozeduren und Packages über temporäres _L8DB_TEMP-Objekt
- Spaltentreffer blinkt dreimal
- Grid-Suche startet im Spaltenmodus
- ganze Spalte beim Treffer hervorheben, Mehrwort-Ranking in Palette und Spaltensuche
- opencode als MCP-Client registrierbar
- About-Seite, Query-Sheets und Tabellenansicht überarbeitet
- MCP-Server mit Redaktion, Read-only-Modus und CLI-Registrierung
- Dokumentation eingebettet in der App öffnen
- row limit, notices, multi-format copy, and related UI improvements
- Überladungen im Outline anzeigen und per Strg+Klick als Peek öffnen
- implement ClickHouse browser proxy and database interaction

### Fixes
- Strg+C lässt markierten Text nativ kopieren statt den aktiven Zellwert
- Strg+C kopiert keinen Zellwert, wenn der Fokus außerhalb des Grids liegt (z. B. Master-Detail-SQL-Dialog)
- Prüfen meldet keine Phantom-Reste bei fehlgeschlagenen Views, lässt Tabellen-Qualifier bei gleichnamigem Package stehen und kürzt Temp-Namen auf 30 Bytes
- Prüfen läuft als ein serverseitiger Block, räumt Temp-Objekte garantiert ab und prüft keine Aufrufer-Kopien mehr
- Prüfen parst Abfragen, DML und PL/SQL-Blöcke wirklich und lehnt nicht prüfbares DDL ab
- Bereichsrahmen wird nicht mehr von der Zeilennummern-Spalte überdeckt
- Master-Detail-Kette über mehrere Bereiche automatisch durchreichen
- PL/SQL-Blöcke und gemischte Skripte als Transaktion erkennen
- Biome-Formatierung, fehlendes Github-Icon und toten Query-Code
- deaktivierten Server als nicht verbunden melden
- SQL-Härtung gegen Redaktions-Umgehung und Schema-Ausbruch
- Spaltenbreite an Titel berücksichtigt FK-Icon wieder
- Oracle-Packages als Packages statt Routinen anzeigen
- localStorage-Quota nicht mehr überschreiten
- sticky table header auch bei fixierten Spalten
- Originalfehler im Passwort-Dialog anzeigen

### Performance
- WebView2 gibt unter Windows Speicher frei, wenn das Fenster den Fokus verliert
- Monaco, FK-Drawer und Layout-Animation erst bei Bedarf laden
- JSON-Ansicht bei großen Ergebnissen in WebKit nicht mehr blockieren

### Änderungen
- Dashboard-Charts, MCP-Ansicht und About-Seite in kleinere Komponenten aufgeteilt

## [0.5.98] - 2026-09-16

### Features
- opencode als MCP-Client registrierbar
- About-Seite, Query-Sheets und Tabellenansicht überarbeitet
- MCP-Server mit Redaktion, Read-only-Modus und CLI-Registrierung
- Dokumentation eingebettet in der App öffnen
- row limit, notices, multi-format copy, and related UI improvements
- Überladungen im Outline anzeigen und per Strg+Klick als Peek öffnen
- implement ClickHouse browser proxy and database interaction

### Fixes
- Biome-Formatierung, fehlendes Github-Icon und toten Query-Code
- deaktivierten Server als nicht verbunden melden
- SQL-Härtung gegen Redaktions-Umgehung und Schema-Ausbruch
- Spaltenbreite an Titel berücksichtigt FK-Icon wieder
- Oracle-Packages als Packages statt Routinen anzeigen
- localStorage-Quota nicht mehr überschreiten
- sticky table header auch bei fixierten Spalten
- Originalfehler im Passwort-Dialog anzeigen

### Performance
- JSON-Ansicht bei großen Ergebnissen in WebKit nicht mehr blockieren

## [0.5.79] - 2026-09-15

### Features
- add connection group navigation and disconnect functionality
- Vergleiche case-insensitiv, toleranterer SQL-Parser und E2E-Test gegen Postgres
- ähnliche Hosts per frei definierbaren Mustern gruppieren
- add monochromeCells setting and integrate into DataTableCell for conditional styling
- implement numbered bookmark slots in the query editor with validation and UI updates
- Spaltenbreiten-Einstellung, Zell-Edit per Blur und Icon-Morphing
- SQL-Fehlermarkierung im Editor und PL/SQL-Mitglieder-Outline
- SQL-Fehler mit Positionsangabe und Oracle Compile-Details
- zustandsabhängige Icons mit morphicons animieren
- native Browser-Features unterdrücken (Kontextmenü, Reload, Drucken, Suche, Zurück-Navigation, Ctrl+Wheel-Zoom, Bild-/Link-Drag)
- Master-Detail verketten (Pane N-1 → N) und FK-SQL automatisch vorbelegen
- extract constraints into dedicated component and tab
- add provider-aware SSL defaults and support `encrypt` query parameter
- Suchergebnisse nach Relevanz sortieren (exakt, Präfix, Wortanfang, Teiltreffer)
- "In … anzeigen" öffnet neuen Tab statt Drawer
- Angebot statt Autostart, Minimieren und besseres Spotlight
- Spaltenbreiten an Titel anpassen
- Collapse-Komponente für Höhen-Animationen
- open FK references in stackable resizable 3D drawer
- infer foreign keys for views from base tables
- navigate to query editor after opening new tab
- add OpenInQueryEditorButton to view editor toolbar
- add tooltip to column search toggle in TableSearchModal
- remove search include columns toggle and related store binding
- replace auto-open "new" editor with empty-state view
- Verbindungsübersicht mit Aktionsmenüs und Gruppen-Löschen
- Verbindungseditor auf zwei Schritte mit Erweitert-Bereich vereinfachen
- install Oracle Instant Client on Windows via button

### Fixes
- Biome-Formatierung und robusteren Timeout-Test
- leeres Passwort vor dem Verbindungsaufbau klar melden statt ORA-01005
- Passwort-Dialog bei jedem Auth-Fehler der aktiven Verbindung, Secrets beim Start sequenziell laden
- fehlendes Passwort im Verbindungsstring aus dem Session-Cache nachziehen
- Strg+Klick (Go to Definition) wiederherstellen – goToCommands explizit registrieren (fehlt in register.all von 0.56)
- Keychain-Zugriffe in spawn_blocking auslagern, damit sie den Tokio-Runtime nicht blockieren
- FK-Filter beim Öffnen in Tab übernehmen
- Autocomplete wiederherstellen – suggestController explizit registrieren (fehlt in register.all von 0.56)
- Drawer schließen, wenn Tabelle in Tab geöffnet wird
- Verbindungstest beim Wechsel mit Timeout absichern, damit ein hängender Test nicht alle weiteren Wechsel blockiert
- tote Idle-Verbindungen vor Nutzung per Ping erkennen und ersetzen
- Provider-Liste nachladen, wenn der Start-Load fehlschlug (Oracle-Verbindungen wurden als Postgres angezeigt)
- doppelte Spaltennamen im Ergebnis durchnummerieren (barcode, barcode1, …)
- vor Verbindungswechsel zur Startseite navigieren, damit Tabs nicht in die neue Verbindung übernommen werden
- Ergebnisspalten per Index keyen, damit doppelte Spaltennamen beim Scrollen nicht vervielfacht werden
- Verbindungssuche findet Teiltreffer auch im Regex-Modus
- Verbindungssuche filtert zuverlässig
- aktiven Tab erst nach Navigation schließen, damit er nicht wieder erscheint
- Strg+Pfeiltasten springen wortweise
- Strg/Cmd+G springt zu Zeile statt Weitersuchen
- Overscroll-Nachfedern im Tabellen-Scrollcontainer unterbinden
- CodeRabbit-Major-Findings zu FK-Views, Collapse, Drawer und Tour
- Collapse SSR-stabil machen und window-Mock reparieren
- bei Verbindungswechsel zur Startseite navigieren
- Sortable-Drag nur auf Tab-Label beschränken
- Pointer-Events auf FK-Drawer-Chrome wiederherstellen
- hängende FKs entfernen und Layout-Fallback
- flüssiges Resize per MotionValue während des Ziehens
- make search bars sticky and relocate sidebar tabs
- gespeichertes Passwort nach abgelehnter Anmeldung aktualisieren
- injectUrlPassword ersetzt bestehendes Passwort in der URL

### Performance
- user_objects statt all_objects fürs eigene Schema, Fetch-Batches auf 1000 erhöht

### Änderungen
- clean up code formatting and remove unnecessary lines
- Legacy-Filter-Migrationsbutton entfernen
- Collapse für Filter-Panel und Spaltenliste
- remove FilterExpressionInput and move operator translation setting

## [0.5.2] - 2026-09-14

### Features
- Angebot statt Autostart, Minimieren und besseres Spotlight
- Spaltenbreiten an Titel anpassen
- Collapse-Komponente für Höhen-Animationen
- open FK references in stackable resizable 3D drawer
- infer foreign keys for views from base tables
- navigate to query editor after opening new tab
- add OpenInQueryEditorButton to view editor toolbar
- add tooltip to column search toggle in TableSearchModal
- remove search include columns toggle and related store binding
- replace auto-open "new" editor with empty-state view

### Fixes
- CodeRabbit-Major-Findings zu FK-Views, Collapse, Drawer und Tour
- Collapse SSR-stabil machen und window-Mock reparieren
- bei Verbindungswechsel zur Startseite navigieren
- Sortable-Drag nur auf Tab-Label beschränken
- Pointer-Events auf FK-Drawer-Chrome wiederherstellen
- hängende FKs entfernen und Layout-Fallback
- flüssiges Resize per MotionValue während des Ziehens
- make search bars sticky and relocate sidebar tabs

### Änderungen
- Legacy-Filter-Migrationsbutton entfernen
- Collapse für Filter-Panel und Spaltenliste
- remove FilterExpressionInput and move operator translation setting

## [0.4.39] - 2026-09-14

### Features
- Verbindungsübersicht mit Aktionsmenüs und Gruppen-Löschen
- Verbindungseditor auf zwei Schritte mit Erweitert-Bereich vereinfachen
- install Oracle Instant Client on Windows via button

### Fixes
- gespeichertes Passwort nach abgelehnter Anmeldung aktualisieren
- injectUrlPassword ersetzt bestehendes Passwort in der URL

## [0.4.31] - 2026-09-14

- Keine Änderungen.

## [0.4.29] - 2026-09-14

### Features
- add Tooltip wrappers and improve icon button accessibility
- improve workspace workflows and data operations
- centralize database execution and provider support

### Fixes
- repair updater manifest urls and action inputs
- preload editor worker
- migrate editor integration to 0.56
- adapt application to dependency updates

## [0.4.5] - 2026-09-12

### Weitere Änderungen
- Release: development into main

## [0.4.3] - 2026-09-10

### Weitere Änderungen
- Merge development into main

## [0.4.1] - 2026-09-09

### Features
- responsive row height scaling and view toggle cleanup
- Dashboards aus Datei laden und mit Datei synchron halten
- fokussierte Zelle mit einem Klick bearbeiten
- open workspace tools like compare and ER diagram as tabs
- add SidebarWindow virtualisation and related refinements
- integrate chart palette and dashboard canvas components
- regex object search with persisted search history
- implement connection authentication guard and error handling
- introduce sidebar search input and connection switcher
- enhance connection management and UI components
- add dashboard route and sidebar integration
- integrate SwitchButton for column visibility toggling
- add auto-sizing feature for table columns
- enhance error handling in query result components
- enhance MongoDB error handling in connectionError function
- implement automated changelog generation and PR creation
- add bug report dialog and integrate diagnostic information collection
- Import von Toad for Oracle Verbindungsexporten (XML)
- implement connection window opening and enhance read-only mode handling
- Passwort-Abfrage beim Verbinden ohne hinterlegtes Passwort mit optionalem Speichern
- TNS-Modus im Verbindungseditor mit Alias-Auswahl aus tnsnames.ora
- STRG+Klick auf Tabellen in PL/SQL-Selects öffnet Ergebnis-Tab, Parameter-Dialog für alle Datenbanken
- View-Definition als vollständiges CREATE OR REPLACE FORCE VIEW mit Spaltenliste und BEQUEATH
- vollständige CREATE-Skripte für Trigger, Typen und Routinen in allen Adaptern
- gemeinsame Diff-Minimap und Plus/Minus-Zähler im Header
- JSON-Abfragen, Collection-Verwaltung und Browser-Tests
- make column search optional in sidebar and advanced search
- red dot indicators, periodic checks and skip-version
- open view definition as full DDL in query editor
- add search filter to function and package lists
- add bug report button that opens a prefilled mail
- introduce @tanstack/react-hotkeys and overhaul query workspace
- rotes X in Sidebar, Compile-pro-Gruppe und Outputs-Page
- Extension API v1.1 mit Abfragen, Netzwerk, Prozessen, Ansichten, Panels und Dialogen
- Mitgliederliste pro Package resizebar merken
- Spec/Body als Tabs mit Mitglieder-Outline statt Accordion
- Auswahl ausführen und Editieren klar von Speichern trennen
- customize table detail tabs
- show connection status indicators
- compact playful table tabs with overflow menu
- add table detail tab visibility controls and refine tab bar
- one-click select the schema matching the db user in schema picker
- context menu with duplicate and create-similar on connection cards
- add content search to table search modal and refactor detail tabs
- group connections by server and add template support
- Vergleich von der aktiven Verbindung im Modal einrichten
- Changelog und Release-Notes automatisch aus Git-Tags erzeugen
- sichtbare Schemas pro Verbindung scannen und filtern
- datenbewahrendes In-Place-Update für Community Extensions
- Splitansicht bis 2x2 mit Drag & Drop wiederherstellen, Verbindungs-Badges entfernen
- native Windows-Titelleiste durch eigene Fenster-Controls ersetzen
- Migrationsskript aus Schema-Snapshot-Vergleich erzeugen
- XLSX-Export ohne Zusatzabhängigkeit (eigener ZIP/OOXML-Writer)
- Objekte vergleichen und in anderes Schema kopieren (inkl. Datentransfer)
- Objekte umbenennen, ändern, löschen mit DDL-Vorschau und Audit-Tab
- Performance-Test aus dem Query-Arbeitsplatz, gemeinsamer Läufer und Report
- add object administration, schema object copy, and table performance testing
- add database monitor page
- Used-By-Analyse, Synonyme browsen, Scheduler-Jobs (inkl. Server-Output-Backend aus 069)
- Server-Ausgabe (NOTICE/DBMS_OUTPUT) im Query-Arbeitsplatz anzeigen
- Regex-Suche mit Helper und Live-Trefferzählung
- Prozeduren als Objektfamilie, Kompilieren per Kontextmenü, Debugger-Einstieg (inkl. Bind-Parameter-Backend aus 060)
- PostgreSQL-Abfragen mit Bind-Parametern ausführen
- Zeile duplizieren im Edit-State mit änderbarem Primärschlüssel
- Benannte Arbeitsplatzstände und fokussiertes ER-Diagramm
- Tabellendaten per Primärschlüssel vergleichen und Sync-Skript erzeugen
- Ausführungspläne speichern, offline öffnen und vergleichen
- Vollständiger Tabellenexport, Exportvorlagen und Spaltenmaskierung
- Query-Bibliothek importieren/exportieren und lokales Diagnosepaket
- Grafischer SELECT-Builder mit Fremdschlüssel-Join
- Objektdefinitionen vergleichen und Tabellenmetadaten-Snapshots
- Tab-übergreifende Suche, Editor-Lesezeichen, Skriptausführung mit Einzelergebnissen
- Durchsuchbare Tastenkürzelhilfe und Fenstertitel mit Verbindungskontext
- DDL-Vorschau vor CREATE TABLE und Tabellenspalten als Vorlage
- INSERT-SQL-Export und CSV-Export mit Optionen und Vorschau
- SQL-Formatierung nach Provider-Dialekt mit Einrückungs- und Keyword-Optionen
- Globale Objektsuche, Spaltensuche, Quelltextsuche, Objektfavoriten
- Zellwert-Popup-Editor, FK-Wertauswahl, Auto-Refresh
- SQL-Snippets verwalten und mit Platzhaltern einfügen
- CSV-Importvorschau, Spaltenmapping und atomarer Import
- Layoutprofile, Zellbereiche als TSV kopieren, Kennzahlen für Auswahl
- Abfrageergebnisse lokal sortieren und filtern
- redesign settings page with modular sidebar tabs, live preview and search
- PostgreSQL-Verbindungen im Lesemodus öffnen
- Grid-Textsuche, Spalten fixieren, Spaltennamen kopieren
- Markiertes SQL und Statement unter dem Cursor ausführen
- Kapitel-Tour mit Spotlight, Warte-Schritten und Autopilot
- Update als freies Popup statt Modal anzeigen
- Profile exportieren/importieren, Favoriten, Verbindungsfarbe
- Blockierende Sitzungen, Filter und Gruppierung
- SQL-Dateien öffnen, speichern und externe Änderungen erkennen
- Oracle-Netzwerkreichweite prüfen, ezconnect-Parsing und Connection-Switch-Zustand mit zustand
- add Oracle key-value parsing, auto-updater, and connection test timeout
- 13 neue L8DB-PLAN-Tickets (063–075) hinzufügen
- custom icons for connections, databases and schemas
- Speichern per Slide-Button im Footer, Testen daneben
- automatic push-triggered releases with packaging channels
- About-Seite implementieren und Tabellenheader refaktorisieren
- Full-DB-Client, Extensions und 0.1.0 Production-Release (#1)
- Datenbank-Erweiterungen, Extensions-UI, Import-View und Biome-Setup
- enhance TableColumnsList with search and filter functionality
- add columns tab to ViewEditorView for enhanced table management
- add TableColumnsList component and integrate into TableView
- add SidebarRoleList component to enhance sidebar functionality
- add sequences management features and enhance routing
- add DataTypeCombobox for improved data type selection in AlterTableView
- implement alter table functionality with new routes and UI components
- enhance sidebar functionality with table management actions
- add NewRowDialog component for row insertion in table view
- implement row management features in the data table
- enhance SQL formatting capabilities in the editor
- refactor views and enhance routing structure
- add new views for About, Connections, ER Diagram, Extensions, Functions, Home, and Query Management
- refactor table triggers management and enhance sidebar functionality
- enhance application with new routes, components, and dependencies
- add user role management and routing
- enhance SQL validation and execution in Function and Extension pages
- add support for functions and extensions in sidebar and routing
- enhance transaction management and UI synchronization
- implement transaction management and UI integration
- enhance DataTable with resizing and layout improvements
- enhance table tab management with entity type support
- enhance DataTable and QueryEditorPane with pagination and layout improvements
- refactor sidebar panel for improved resizing and layout
- enhance sidebar and SQL editor functionality
- implement view management and definition display
- enhance query routing and tab management
- add query editor and result table components
- enhance DataTable with popover filtering functionality
- implement table views functionality with filtering and saving options
- add settings page and integrate into routing and header
- add AGENTS.md documentation and implement row update functionality
- App-Header mit Suche und Layout über der Sidebar
- enhance DataTable and TablePage with improved data handling and UI elements
- implement data table and SQL editor components for enhanced data management
- add SQL editor component and integrate into TableFilterPanel
- add table filter panel and enhance database selection
- enhance ConnectionsPage with improved UI and connection string masking
- enhance routing and introduce table tab management
- integrate table management and enhance sidebar functionality
- implement sidebar resizing functionality and state management
- implement connections management and enhance sidebar functionality
- implement AppSidebarIconRail component for improved sidebar navigation
- add logo and improve code consistency in AppSidebar and AppLayout
- add new UI components and update dependencies
- Add new components and update dependencies for improved UI

### Fixes
- Windows-Releasebuild durch portable CSP-Prüfung reparieren (#32)
- kein Render-Loop mehr beim schnellen Scrollen
- Monaco-Tooltips blockieren keine Klicks mehr
- keine Transaktion für View-DDL und implizit committende Dialekte
- resolve frontend formatting checks
- satisfy Biome checks
- Views und Materialized Views im SQL-Linter als bekannte Tabellen behandeln
- App-Icon im Apple-Squircle-Raster statt rundem Logo
- Verbindungs-Toast immer schließen und Aktivierung mit Timeout absichern
- Funktions-/Prozedur-/Package-Quelltext als CREATE OR REPLACE mit Schema liefern
- compile simple filters per SQL dialect instead of Postgres-only ILIKE
- derive header type badge from column metadata instead of first row value
- offer filter/sort reset and retry in table load error state
- add spacing between diagnose rows
- anchor Monaco hover tooltips to the editor container
- prevent horizontal overflow in hotkey lists
- stop re-revealing member line on every keystroke while editing
- name new query tabs per connection instead of globally
- render Monaco overflow widgets outside transformed ancestors
- guard setLayout until both panels are registered after editor focus toggle
- smooth horizontal scrolling in wide tables
- satisfy frontend Biome checks
- Bedienpanel klickbar und Popover im App-Theme
- widen connection picker layout
- reorder NOT NULL constraint after DEFAULT in column definition SQL
- Kommentare, Semikolons und PL/SQL-Terminator vor Ausführung korrekt behandeln
- ausgeblendetes aktives Schema auf sichtbares Schema zurücksetzen
- Import-Sortierung nach Biome-Vorgabe korrigieren
- Typdeklaration für basic-languages/sql
- Tastatur in Eingabefeldern nicht abfangen, Pulse bei reduced-motion aus
- use tauri-action v0 for updater inputs parity with l8git
- downgrade react-table to v8, fix remaining biome errors
- Filter-Popover im Table-Header bleibt nach Rechtsklick offen
- remove stray repro route from release
- resolve biome errors, es2022 lib and per-connection split persistence
- update SQL query to cast data_type to text for better compatibility
- streamline TableFilterPanel component and improve condition handling
- adjust padding in AppSidebarPanel header for improved layout
- integrate TooltipProvider in SidebarProvider for improved tooltip handling

### Performance
- 60 FPS in Übersicht, Dashboard und Tabellenansicht sichern
- Oracle-Verbindungspools, lazy Sidebar-Metadaten und Instant-Client-Suche
- accelerate grids, startup, SQL editing and PostgreSQL results
- Virtualisierung, Layout-Animationen und Polling entschärft, MSSQL/ODBC-Pooling, Performance-Tests
- Route-Code-Splitting aktivieren und React-Plugin auf oxc (v6) heben

### Änderungen
- remove unused scroll-idle import
- throttle update checks with focus and visibility-driven re-checks
- update props to use HTMLMotionProps for better type safety
- remove TableColumnHighlight component and update related references
- streamline authentication error handling
- replace native select with radix select in auto-refresh
- clean up AppHeader component structure
- clean up DataTable component by removing debug logging and unused functions
- enhance SqlEditor and Calendar components with type annotations and code consistency
- update sidebar and enhance TableFilterPanel with animations
- simplify TableTabs and enhance data fetching logic
- improve layout and responsiveness of TableFilterPanel and TablePage
- simplify layout structure in AppLayout and TablePage
- streamline AppSidebar components and enhance navigation
- simplify AppSidebar and enhance navigation with React Router
- clean up HomePage component and update AppLayout imports
- restructure layout components and update TypeScript configuration

### Weitere Änderungen
- Fix Oracle bulk host editing
- fix window dragging in app header
- Improve table footer alignment
- Persist workspace tabs per connection
- Feat: sidebar animation
- Fix Windows Fenster-Buttons: fehlende Tauri-Permissions und Klicks durch Drag-Region.
- Type(scope): Beschreibung
- ---
- init

## [0.3.53] - 2026-09-09

### Fixes
- kein Render-Loop mehr beim schnellen Scrollen

## [0.3.49] - 2026-09-09

### Features
- responsive row height scaling and view toggle cleanup
- Dashboards aus Datei laden und mit Datei synchron halten
- fokussierte Zelle mit einem Klick bearbeiten

### Fixes
- Monaco-Tooltips blockieren keine Klicks mehr

## [0.3.42] - 2026-09-09

### Features
- open workspace tools like compare and ER diagram as tabs
- add SidebarWindow virtualisation and related refinements

### Fixes
- keine Transaktion für View-DDL und implizit committende Dialekte

### Performance
- 60 FPS in Übersicht, Dashboard und Tabellenansicht sichern

### Änderungen
- remove unused scroll-idle import
- throttle update checks with focus and visibility-driven re-checks

## [0.3.32] - 2026-09-09

### Features
- integrate chart palette and dashboard canvas components
- regex object search with persisted search history
- implement connection authentication guard and error handling
- introduce sidebar search input and connection switcher
- enhance connection management and UI components
- add dashboard route and sidebar integration
- integrate SwitchButton for column visibility toggling
- add auto-sizing feature for table columns
- enhance error handling in query result components

### Fixes
- resolve frontend formatting checks

### Änderungen
- update props to use HTMLMotionProps for better type safety
- remove TableColumnHighlight component and update related references

## [0.3.17] - 2026-09-08

### Features
- enhance MongoDB error handling in connectionError function
- implement automated changelog generation and PR creation
- add bug report dialog and integrate diagnostic information collection
- Import von Toad for Oracle Verbindungsexporten (XML)
- implement connection window opening and enhance read-only mode handling
- Passwort-Abfrage beim Verbinden ohne hinterlegtes Passwort mit optionalem Speichern
- TNS-Modus im Verbindungseditor mit Alias-Auswahl aus tnsnames.ora
- STRG+Klick auf Tabellen in PL/SQL-Selects öffnet Ergebnis-Tab, Parameter-Dialog für alle Datenbanken
- View-Definition als vollständiges CREATE OR REPLACE FORCE VIEW mit Spaltenliste und BEQUEATH
- vollständige CREATE-Skripte für Trigger, Typen und Routinen in allen Adaptern
- gemeinsame Diff-Minimap und Plus/Minus-Zähler im Header
- JSON-Abfragen, Collection-Verwaltung und Browser-Tests
- make column search optional in sidebar and advanced search
- red dot indicators, periodic checks and skip-version
- open view definition as full DDL in query editor

### Fixes
- satisfy Biome checks
- Views und Materialized Views im SQL-Linter als bekannte Tabellen behandeln
- App-Icon im Apple-Squircle-Raster statt rundem Logo
- Verbindungs-Toast immer schließen und Aktivierung mit Timeout absichern
- Funktions-/Prozedur-/Package-Quelltext als CREATE OR REPLACE mit Schema liefern
- compile simple filters per SQL dialect instead of Postgres-only ILIKE
- derive header type badge from column metadata instead of first row value
- offer filter/sort reset and retry in table load error state
- add spacing between diagnose rows
- anchor Monaco hover tooltips to the editor container

### Änderungen
- streamline authentication error handling

### Weitere Änderungen
- Fix Oracle bulk host editing

## [0.2.30] - 2026-09-08

### Features
- add search filter to function and package lists
- add bug report button that opens a prefilled mail

### Fixes
- prevent horizontal overflow in hotkey lists
- stop re-revealing member line on every keystroke while editing
- name new query tabs per connection instead of globally
- render Monaco overflow widgets outside transformed ancestors
- guard setLayout until both panels are registered after editor focus toggle
- smooth horizontal scrolling in wide tables

## [0.2.19] - 2026-09-08

### Features
- introduce @tanstack/react-hotkeys and overhaul query workspace
- rotes X in Sidebar, Compile-pro-Gruppe und Outputs-Page
- Extension API v1.1 mit Abfragen, Netzwerk, Prozessen, Ansichten, Panels und Dialogen
- Mitgliederliste pro Package resizebar merken
- Spec/Body als Tabs mit Mitglieder-Outline statt Accordion
- Auswahl ausführen und Editieren klar von Speichern trennen
- customize table detail tabs
- show connection status indicators
- compact playful table tabs with overflow menu
- add table detail tab visibility controls and refine tab bar
- one-click select the schema matching the db user in schema picker
- context menu with duplicate and create-similar on connection cards
- add content search to table search modal and refactor detail tabs
- group connections by server and add template support
- Vergleich von der aktiven Verbindung im Modal einrichten
- Changelog und Release-Notes automatisch aus Git-Tags erzeugen
- sichtbare Schemas pro Verbindung scannen und filtern

### Fixes
- satisfy frontend Biome checks
- Bedienpanel klickbar und Popover im App-Theme
- widen connection picker layout
- reorder NOT NULL constraint after DEFAULT in column definition SQL
- Kommentare, Semikolons und PL/SQL-Terminator vor Ausführung korrekt behandeln
- ausgeblendetes aktives Schema auf sichtbares Schema zurücksetzen

### Performance
- Oracle-Verbindungspools, lazy Sidebar-Metadaten und Instant-Client-Suche

### Änderungen
- replace native select with radix select in auto-refresh

### Weitere Änderungen
- fix window dragging in app header
- Improve table footer alignment
- Persist workspace tabs per connection
- Feat: sidebar animation

## [0.1.161] - 2026-09-07

### Features
- datenbewahrendes In-Place-Update für Community Extensions

### Fixes
- Import-Sortierung nach Biome-Vorgabe korrigieren

### Performance
- accelerate grids, startup, SQL editing and PostgreSQL results
- Virtualisierung, Layout-Animationen und Polling entschärft, MSSQL/ODBC-Pooling, Performance-Tests

### Weitere Änderungen
- Fix Windows Fenster-Buttons: fehlende Tauri-Permissions und Klicks durch Drag-Region.

## [0.1.154] - 2026-09-07

### Features
- Splitansicht bis 2x2 mit Drag & Drop wiederherstellen, Verbindungs-Badges entfernen
- native Windows-Titelleiste durch eigene Fenster-Controls ersetzen
- Migrationsskript aus Schema-Snapshot-Vergleich erzeugen
- add Oracle key-value parsing, auto-updater, and connection test timeout
- XLSX-Export ohne Zusatzabhängigkeit (eigener ZIP/OOXML-Writer)
- 13 neue L8DB-PLAN-Tickets (063–075) hinzufügen
- Objekte vergleichen und in anderes Schema kopieren (inkl. Datentransfer)
- Objekte umbenennen, ändern, löschen mit DDL-Vorschau und Audit-Tab
- Performance-Test aus dem Query-Arbeitsplatz, gemeinsamer Läufer und Report
- add object administration, schema object copy, and table performance testing
- add database monitor page
- Used-By-Analyse, Synonyme browsen, Scheduler-Jobs (inkl. Server-Output-Backend aus 069)
- Server-Ausgabe (NOTICE/DBMS_OUTPUT) im Query-Arbeitsplatz anzeigen
- Regex-Suche mit Helper und Live-Trefferzählung
- Prozeduren als Objektfamilie, Kompilieren per Kontextmenü, Debugger-Einstieg (inkl. Bind-Parameter-Backend aus 060)
- PostgreSQL-Abfragen mit Bind-Parametern ausführen
- Zeile duplizieren im Edit-State mit änderbarem Primärschlüssel
- Benannte Arbeitsplatzstände und fokussiertes ER-Diagramm
- Tabellendaten per Primärschlüssel vergleichen und Sync-Skript erzeugen
- Ausführungspläne speichern, offline öffnen und vergleichen
- Vollständiger Tabellenexport, Exportvorlagen und Spaltenmaskierung
- Query-Bibliothek importieren/exportieren und lokales Diagnosepaket
- Grafischer SELECT-Builder mit Fremdschlüssel-Join
- Objektdefinitionen vergleichen und Tabellenmetadaten-Snapshots
- Tab-übergreifende Suche, Editor-Lesezeichen, Skriptausführung mit Einzelergebnissen
- Durchsuchbare Tastenkürzelhilfe und Fenstertitel mit Verbindungskontext
- DDL-Vorschau vor CREATE TABLE und Tabellenspalten als Vorlage
- INSERT-SQL-Export und CSV-Export mit Optionen und Vorschau
- SQL-Formatierung nach Provider-Dialekt mit Einrückungs- und Keyword-Optionen
- Globale Objektsuche, Spaltensuche, Quelltextsuche, Objektfavoriten
- Zellwert-Popup-Editor, FK-Wertauswahl, Auto-Refresh
- SQL-Snippets verwalten und mit Platzhaltern einfügen
- CSV-Importvorschau, Spaltenmapping und atomarer Import
- Layoutprofile, Zellbereiche als TSV kopieren, Kennzahlen für Auswahl
- Abfrageergebnisse lokal sortieren und filtern
- redesign settings page with modular sidebar tabs, live preview and search
- PostgreSQL-Verbindungen im Lesemodus öffnen
- Grid-Textsuche, Spalten fixieren, Spaltennamen kopieren
- Markiertes SQL und Statement unter dem Cursor ausführen
- Kapitel-Tour mit Spotlight, Warte-Schritten und Autopilot
- Update als freies Popup statt Modal anzeigen
- Profile exportieren/importieren, Favoriten, Verbindungsfarbe
- Blockierende Sitzungen, Filter und Gruppierung
- SQL-Dateien öffnen, speichern und externe Änderungen erkennen
- Oracle-Netzwerkreichweite prüfen, ezconnect-Parsing und Connection-Switch-Zustand mit zustand

### Fixes
- use tauri-action v0 for updater inputs parity with l8git
- Typdeklaration für basic-languages/sql
- Tastatur in Eingabefeldern nicht abfangen, Pulse bei reduced-motion aus

### Performance
- Route-Code-Splitting aktivieren und React-Plugin auf oxc (v6) heben

### Weitere Änderungen
- Type(scope): Beschreibung

## [0.1.99] - 2026-09-06

### Features
- About-Seite implementieren und Tabellenheader refaktorisieren
- custom icons for connections, databases and schemas
- Speichern per Slide-Button im Footer, Testen daneben
- Full-DB-Client, Extensions und 0.1.0 Production-Release (#1)
- automatic push-triggered releases with packaging channels
- Datenbank-Erweiterungen, Extensions-UI, Import-View und Biome-Setup
- enhance TableColumnsList with search and filter functionality
- add columns tab to ViewEditorView for enhanced table management
- add TableColumnsList component and integrate into TableView
- add SidebarRoleList component to enhance sidebar functionality
- add sequences management features and enhance routing
- add DataTypeCombobox for improved data type selection in AlterTableView
- implement alter table functionality with new routes and UI components
- enhance sidebar functionality with table management actions
- add NewRowDialog component for row insertion in table view
- implement row management features in the data table
- enhance SQL formatting capabilities in the editor
- refactor views and enhance routing structure
- add new views for About, Connections, ER Diagram, Extensions, Functions, Home, and Query Management
- refactor table triggers management and enhance sidebar functionality
- enhance application with new routes, components, and dependencies
- add user role management and routing
- enhance SQL validation and execution in Function and Extension pages
- add support for functions and extensions in sidebar and routing
- enhance transaction management and UI synchronization
- implement transaction management and UI integration
- enhance DataTable with resizing and layout improvements
- enhance table tab management with entity type support
- enhance DataTable and QueryEditorPane with pagination and layout improvements
- refactor sidebar panel for improved resizing and layout
- enhance sidebar and SQL editor functionality
- implement view management and definition display
- enhance query routing and tab management
- add query editor and result table components
- enhance DataTable with popover filtering functionality
- implement table views functionality with filtering and saving options
- add settings page and integrate into routing and header
- add AGENTS.md documentation and implement row update functionality
- App-Header mit Suche und Layout über der Sidebar
- enhance DataTable and TablePage with improved data handling and UI elements
- implement data table and SQL editor components for enhanced data management
- add SQL editor component and integrate into TableFilterPanel
- add table filter panel and enhance database selection
- enhance ConnectionsPage with improved UI and connection string masking
- enhance routing and introduce table tab management
- integrate table management and enhance sidebar functionality
- implement sidebar resizing functionality and state management
- implement connections management and enhance sidebar functionality
- implement AppSidebarIconRail component for improved sidebar navigation
- add logo and improve code consistency in AppSidebar and AppLayout
- add new UI components and update dependencies
- Add new components and update dependencies for improved UI

### Fixes
- downgrade react-table to v8, fix remaining biome errors
- Filter-Popover im Table-Header bleibt nach Rechtsklick offen
- remove stray repro route from release
- resolve biome errors, es2022 lib and per-connection split persistence
- update SQL query to cast data_type to text for better compatibility
- streamline TableFilterPanel component and improve condition handling
- adjust padding in AppSidebarPanel header for improved layout
- integrate TooltipProvider in SidebarProvider for improved tooltip handling

### Änderungen
- clean up AppHeader component structure
- clean up DataTable component by removing debug logging and unused functions
- enhance SqlEditor and Calendar components with type annotations and code consistency
- update sidebar and enhance TableFilterPanel with animations
- simplify TableTabs and enhance data fetching logic
- improve layout and responsiveness of TableFilterPanel and TablePage
- simplify layout structure in AppLayout and TablePage
- streamline AppSidebar components and enhance navigation
- simplify AppSidebar and enhance navigation with React Router
- clean up HomePage component and update AppLayout imports
- restructure layout components and update TypeScript configuration

### Weitere Änderungen
- ---
- init
