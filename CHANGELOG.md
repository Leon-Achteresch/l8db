# Changelog

Alle veröffentlichten Änderungen dieser App, automatisch aus der Git-Historie erzeugt.
Nicht von Hand bearbeiten: `bun run changelog` regeneriert diese Datei.

## [Unreleased]

### Features
- sichtbare Schemas pro Verbindung scannen und filtern

### Fixes
- ausgeblendetes aktives Schema auf sichtbares Schema zurücksetzen

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

### Fixes
- Typdeklaration für basic-languages/sql
- Tastatur in Eingabefeldern nicht abfangen, Pulse bei reduced-motion aus
- use tauri-action v0 for updater inputs parity with l8git

### Performance
- Route-Code-Splitting aktivieren und React-Plugin auf oxc (v6) heben

### Weitere Änderungen
- Type(scope): Beschreibung

## [0.1.99] - 2026-09-06

### Features
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
