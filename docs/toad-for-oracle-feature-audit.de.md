# Feature-Audit: Quest Toad for Oracle

Stand: 6. September 2026. Referenz: Toad for Oracle 2026 R2; ergänzend R1 und ältere offizielle Quest-Dokumentation.

**826 einzeln referenzierbare Funktions- und Optionspunkte in 75 Kategorien.** Das ist eine dokumentengestützte Inventur, kein Test einer installierten Toad-Version und kein Beleg für hundertprozentige Vollständigkeit.

Der Katalog erfasst große Funktionen und kleine Bedienoptionen. Übergeordnete Funktionen und ihre Teiloptionen können sich fachlich überschneiden; die Anzahl bezeichnet Inventareinträge, keine voneinander unabhängigen Module. Identische Eintragstexte sind ausgeschlossen. Englische Produkt- und Menübegriffe bleiben zur Wiedererkennung erhalten.

## Umfang und Nachweisgrenzen

Erfasst sind die Toad-Anwendung, Professional-Funktionen, DB Admin Module, Sensitive Data Protection, KI-Funktionen und die separat benannten Suite-Produkte SQL Optimizer, Code Tester, Benchmark Factory, Spotlight und Toad Data Modeler. Die Zusatzprodukte bilden eigene Abschnitte; ihre Funktionen gehören nicht automatisch zur Toad-Basislizenz.

Die R2-Referenz folgt den [Quest Release Notes](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/release-notes) und der [R2-Veröffentlichungsankündigung](https://forums.toadworld.com/t/toad-for-oracle-2026-r2-is-now-available/61764). Beta-Funktionen aus R3 sind ausgeschlossen. Funktionen anderer Produkte wie Toad Data Point, Toad Data Studio und SQL Navigator wurden nicht als Toad-for-Oracle-Funktionen übernommen.

Quest verweist für die umfassende Benutzerhilfe auf die installierte Hilfe. Deshalb lässt sich der Wunsch „wirklich jeder einzelne Schalter“ mit öffentlich zugänglichen Dokumenten allein nicht abschließend nachweisen. [Quest: Benutzerhandbuch und Hilfe](https://support.quest.com/toad-for-oracle/kb/4270821/where-can-i-find-the-toad-for-oracle-user-guide-or-manual)

## Kennzeichnung

| Kennzeichen | Bedeutung | Einträge |
|---|---|---:|
| D26 | In Dokumentation oder Release-Informationen von 2026 nachgewiesen; teilweise nur als Handbuchkapitel. Nicht praktisch getestet. | 470 |
| H | Älterer offizieller Nachweis. Unveränderte Verfügbarkeit und Menügestaltung in 2026 nicht abschließend geprüft. | 351 |
| M25 | Nachweis aus einer Editions-/Funktionsmatrix von 2025; Voraussetzungen der jeweiligen Authentifizierungsumgebung beachten. | 5 |

**K** bedeutet Funktion der Toad-Anwendung, nicht „garantiert in Base enthalten“. **Pro** bezeichnet Professional-Funktionen, **DBA** das DB Admin Module, **SDP** Sensitive Data Protection und **AI** die entsprechende KI-Freischaltung. Ein ausgeschriebener Produktname bezeichnet ein eigenständiges Zusatzprodukt. Zusätze wie „teilweise DBA“, „Oracle-Utilities“ oder „Windows“ beschreiben zusätzliche Abhängigkeiten. Eine verbindliche Mindestlizenz ist nicht für jede Mikrooption belegt.

Die Quellen am Anfang einer Kategorie gelten für deren Einträge. Hinweise engen die Aussage ein. Die JSON-Datei enthält dieselben IDs, Kategorien, Quellenkennungen und Nachweisstatus für eine spätere Filterung oder Vergleichsmatrix.

## Editionen und Produktgrenzen

Die R2-Unterlagen unterscheiden unter anderem folgende Pakete beziehungsweise Varianten. Die Tabelle nennt wesentliche Unterschiede; sie ersetzt keine vollständige Lizenzstückliste. [Quest: R2-Editionen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/release-notes)

| Edition / Variante | Wesentliche Einordnung |
|---|---|
| Base | Toad-Grundprodukt |
| Professional | Professional-Funktionsumfang |
| Professional DB Admin | Professional mit DB Admin Module und Sensitive Data Protection |
| Xpert Plus | Paket mit SQL Optimizer |
| Developer Plus | Entwicklerpaket mit Code Tester und Benchmark Factory; dokumentiertes Limit 100 virtuelle Benutzer |
| DBA Plus | DBA-Paket mit Spotlight und Benchmark Factory; dokumentiertes Limit 500 virtuelle Benutzer; Modellierungskomponente je Paket |
| DBA RAC / Exadata | Zusätzliche Diagnosekomponenten für RAC beziehungsweise Exadata |
| Varianten „with erwin“ | erwin Data Modeler Lite for Oracle als gesonderte Modellierungskomponente |
| AI-fähige Varianten | KI-Funktionen abhängig von passender Lizenz und Einrichtung |

**Toad Data Modeler und erwin Data Modeler Lite sind verschiedene Produkte.** Die unten erfassten Modeler-Funktionen dürfen nicht auf erwin Lite übertragen werden. Auch virtuelle Benutzerlimits und installierte Versionen der Suite-Produkte sind getrennt zu prüfen.

## Plattform- und Umgebungsabhängigkeiten

Die Inventur betrachtet primär den dokumentierten Windows-Funktionsumfang. Die Mac-Ausgabe hat laut R1-Unterlagen Einschränkungen bei Windows Task Scheduler, Quest Auto Update, Versionsverwaltung in Team Coding, Excel-Instance-/Access-Integration und externen Werkzeugen. Eine aktuelle Gleichheit aller Windows- und Mac-Funktionen wurde nicht geprüft. [Quest: R1 Release Notes](https://support-public.cfm.quest.com/82280_ToadForOracle_2026_R1_ReleaseNotes.pdf)

Clientlose Verbindungen sind möglich. Funktionen mit externen Oracle-Werkzeugen benötigen jedoch die entsprechenden Komponenten, beispielsweise SQL*Plus, Data Pump, Import/Export, SQL*Loader, TKProf, TNSPing und Wrap. [Quest: Verbindungsvoraussetzungen](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/4)

Die tatsächliche Nutzbarkeit hängt außerdem von Oracle-Version, Datenbankberechtigungen, installierten Paketen, Repository-Einrichtung und gegebenenfalls gesonderten Oracle-Lizenzen ab. Ein Feature-Eintrag ist keine Aussage, dass diese Voraussetzungen in einer konkreten Installation erfüllt sind.

## Kategorienübersicht

| Nr. | Kategorie | Punkte | Nachweis |
|---|---|---:|---|

| 01 | [Verbindungen und Anmeldung](#g01) | 11 | D26 |
| 02 | [Oracle-Verbindungsmethoden und Sicherheit](#g02) | 5 | H |
| 03 | [Authentifizierungsvarianten](#g03) | 5 | M25 |
| 04 | [Verbindungen übertragen](#g04) | 6 | D26 |
| 05 | [Verbindungen organisieren](#g05) | 8 | D26 |
| 06 | [Editor: Dateien und Navigation](#g06) | 13 | D26 |
| 07 | [Editor: Suchen und Ersetzen](#g07) | 18 | D26 |
| 08 | [Codevorlagen und Einfügehilfen](#g08) | 7 | D26 |
| 09 | [Snippets und Codevervollständigung](#g09) | 9 | D26 |
| 10 | [Code bearbeiten und aufbereiten](#g10) | 12 | D26 |
| 11 | [SQL ausführen und Skripte verwalten](#g11) | 7 | D26 |
| 12 | [SQL-Historie und PL/SQL-Arbeit](#g12) | 10 | D26 |
| 13 | [Query Builder](#g13) | 24 | D26 |
| 14 | [PL/SQL-Debugger](#g14) | 10 | D26 |
| 15 | [Debugger: Haltepunkte und Zustandsinspektion](#g15) | 10 | D26 |
| 16 | [Haltepunkte und DBMS Output](#g16) | 6 | D26 |
| 17 | [PL/SQL-Profiling](#g17) | 19 | D26 |
| 18 | [Dateivergleich und Merge](#g18) | 7 | D26 |
| 19 | [Schema Browser: Navigation](#g19) | 18 | D26 |
| 20 | [Schema Browser: Filter](#g20) | 8 | D26 |
| 21 | [Objekte finden und beschreiben](#g21) | 9 | D26 |
| 22 | [Objekte erstellen und ändern](#g22) | 9 | D26 |
| 23 | [Dokumentierte Oracle-Objektfamilien](#g23) | 32 | D26 |
| 24 | [Fremdschlüssel und relationale Navigation](#g24) | 12 | D26 |
| 25 | [Grid: Darstellung, Suche und Filter](#g25) | 16 | D26 |
| 26 | [Grid: Daten ändern und rechnen](#g26) | 12 | D26 |
| 27 | [Editierbare Abfragen und Datenkopie](#g27) | 11 | D26 |
| 28 | [Datenvergleich und Synchronisierung](#g28) | 15 | D26 |
| 29 | [Datenvergleich: Schlüssel und Differenzen](#g29) | 12 | H |
| 30 | [Objekt- und Schemavergleich](#g30) | 20 | D26 |
| 31 | [Datenbankvergleich und Rebuild](#g31) | 15 | D26 |
| 32 | [Exportformate und Exportwege](#g32) | 27 | H |
| 33 | [Excel-Export: kleine Optionen](#g33) | 3 | H |
| 34 | [Excel-Dateidetails](#g34) | 2 | H |
| 35 | [Exportüberschriften](#g35) | 1 | H |
| 36 | [Arbeitsblattnamen](#g36) | 1 | H |
| 37 | [Export: Kompression und Dateiverhalten](#g37) | 8 | H |
| 38 | [Tabellenimport](#g38) | 10 | H |
| 39 | [Textimport und SQL*Loader](#g39) | 5 | H |
| 40 | [Testdaten und Codequalität](#g40) | 15 | H |
| 41 | [Testdatengenerator](#g41) | 5 | H |
| 42 | [utPLSQL-Unit-Tests](#g42) | 19 | D26 |
| 43 | [DBA: Monitoring, Statistiken und Diagnose](#g43) | 23 | H |
| 44 | [DBA: Health Checks und Speicherverwaltung](#g44) | 18 | H |
| 45 | [Database Browser: Instanzübersicht](#g45) | 8 | H |
| 46 | [Oracle 23ai und neuere Objektdetails](#g46) | 15 | H |
| 47 | [Automatisierung: Abläufe und Bedingungen](#g47) | 7 | H |
| 48 | [Automatisierung: Verbindungen und Unterabläufe](#g48) | 7 | H |
| 49 | [Automatisierung: Daten- und Datei-Iteratoren](#g49) | 4 | H |
| 50 | [Automatisierung: Zeitplanung und Skriptsammlungen](#g50) | 3 | H |
| 51 | [Script Manager und Batch Jobs](#g51) | 7 | H |
| 52 | [Sensitive Data Protection: Erkennung und Schutz](#g52) | 11 | H |
| 53 | [Sensitive Data Protection: Scan-Optionen](#g53) | 6 | H |
| 54 | [Sensitive Data Protection: Standardrichtlinien](#g54) | 4 | H |
| 55 | [Team Coding und Versionsverwaltung](#g55) | 13 | H |
| 56 | [Git-Integration: Detailoptionen](#g56) | 7 | H |
| 57 | [Git-Integration: Repository-Synchronisation](#g57) | 3 | H |
| 58 | [Berichte und Druck](#g58) | 3 | H |
| 59 | [Berichtsvorlagen](#g59) | 2 | H |
| 60 | [Oberfläche: Menüs und Tastatur](#g60) | 6 | D26 |
| 61 | [Oberfläche: Einstellungen und Layout](#g61) | 6 | D26 |
| 62 | [Barrierearme Tastaturbedienung](#g62) | 4 | H |
| 63 | [2026 R2: KI und kontextbezogene Assistenz](#g63) | 9 | D26 |
| 64 | [2026 R2: kleine Bedienfunktionen](#g64) | 18 | D26 |
| 65 | [2026 R1: zusätzliche Detailfunktionen](#g65) | 32 | D26 |
| 66 | [Zusatzprodukt SQL Optimizer: Optimierung](#g66) | 12 | H |
| 67 | [Zusatzprodukt SQL Optimizer: Analysewerkzeuge](#g67) | 16 | H |
| 68 | [Zusatzprodukt Code Tester: Testverwaltung](#g68) | 6 | H |
| 69 | [Zusatzprodukt Code Tester: Testpflege](#g69) | 6 | H |
| 70 | [Zusatzprodukt Benchmark Factory](#g70) | 20 | H |
| 71 | [Zusatzprodukt Spotlight on Oracle](#g71) | 13 | H |
| 72 | [Zusatzprodukt Spotlight: Editionsoptionen](#g72) | 3 | D26 |
| 73 | [Zusatzprodukt Toad Data Modeler](#g73) | 39 | H |
| 74 | [Verbindungsdialog: zusätzliche Detailoptionen](#g74) | 16 | D26 |
| 75 | [Explain Plan und integrierte Hilfe](#g75) | 7 | D26 |

## Einzelinventar

<a id="g01"></a>

### 01. Verbindungen und Anmeldung

Modul: **K** · Nachweis: **D26** · 11 Punkte.

Quellen: [CON: Getting Started 2026 R1 – Verbindungen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/5).

- **TOAD-0001** — Mehrere Datenbankverbindungen gleichzeitig
- **TOAD-0002** — Verbindungsprofile anlegen
- **TOAD-0003** — Verbindungsprofile bearbeiten
- **TOAD-0004** — Gespeicherte Verbindungen erneut öffnen
- **TOAD-0005** — Automatische Anmeldung beim Programmstart
- **TOAD-0006** — Aktive Verbindung eines Fensters wechseln
- **TOAD-0007** — Verbindungen testen
- **TOAD-0008** — Verbindungen schließen
- **TOAD-0009** — Passwörter optional speichern
- **TOAD-0010** — Änderungen ausdrücklich committen
- **TOAD-0011** — Änderungen ausdrücklich zurückrollen

<a id="g02"></a>

### 02. Oracle-Verbindungsmethoden und Sicherheit

Modul: **K / Oracle-Client** · Nachweis: **H** · 5 Punkte.

Quellen: [CON17: Quest: Verbindungen in Release 17.0](https://forums.toadworld.com/t/toad-for-oracle-toad-for-oracle-on-mac-17-0-341-1977-is-now-available/58422).

Hinweis: Native Oracle-Client-Verfahren und clientlose Verfahren haben unterschiedliche Voraussetzungen.

- **TOAD-0012** — Verbindung ohne installierten Oracle-Client
- **TOAD-0013** — Verbindung über Oracle Home
- **TOAD-0014** — TCPS auch im clientlosen Modus
- **TOAD-0015** — SSH-Verbindungen direkt in Toad konfigurieren
- **TOAD-0016** — Containerwechsel bei passender Oracle-Berechtigung

<a id="g03"></a>

### 03. Authentifizierungsvarianten

Modul: **K / Oracle-Umgebung** · Nachweis: **M25** · 5 Punkte.

Quellen: [AUTH: Subscription Functional Matrix 2025 R3](https://www.quest.com/documents/quest-toad-for-oracle-subscription-editions-functional-matrix-datasheet-173484.pdf).

Hinweis: Die Matrix nennt diese Verfahren; sie sind keine Zusage, dass jedes Verfahren ohne Oracle-Client funktioniert.

- **TOAD-0017** — Kerberos-Anmeldung
- **TOAD-0018** — Oracle-Wallet-Unterstützung
- **TOAD-0019** — RADIUS-Anbindung
- **TOAD-0020** — Okta-Anbindung
- **TOAD-0021** — MFA-Unterstützung über passende Authentifizierungsinfrastruktur

<a id="g04"></a>

### 04. Verbindungen übertragen

Modul: **K** · Nachweis: **D26** · 6 Punkte.

Quellen: [CEXP: Quest: Verbindungen samt verschlüsselten Passwörtern übertragen](https://support.quest.com/toad-for-oracle/2026%20r1).

- **TOAD-0022** — Verbindungsprofile exportieren
- **TOAD-0023** — Verbindungsprofile importieren
- **TOAD-0024** — Passwörter beim Export weglassen
- **TOAD-0025** — Verschlüsselte Passwörter mitexportieren
- **TOAD-0026** — Exportpasswörter durch Hauptpasswort schützen
- **TOAD-0027** — Passwörter beim Import wiederherstellen

<a id="g05"></a>

### 05. Verbindungen organisieren

Modul: **K** · Nachweis: **D26** · 8 Punkte.

Quellen: [CORG: Getting Started 2026 R1 – Anpassung von Verbindungen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/45).

Hinweis: Details sind im Kapitel Customize Connections dokumentiert.

- **TOAD-0028** — Verbindungen farblich kennzeichnen
- **TOAD-0029** — Nur favorisierte Verbindungen anzeigen
- **TOAD-0030** — Eigene Spalten im Anmeldedialog
- **TOAD-0031** — Verbindungen gruppieren
- **TOAD-0032** — Verbindungsbaum statt flacher Liste
- **TOAD-0033** — Verbindungsspalten ein-/ausblenden
- **TOAD-0034** — Nach Oracle Home filtern
- **TOAD-0035** — Tabs nach Server oder Benutzer

<a id="g06"></a>

### 06. Editor: Dateien und Navigation

Modul: **K** · Nachweis: **D26** · 13 Punkte.

Quellen: [ED: Getting Started 2026 R1 – Editor Basics](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/7).

- **TOAD-0036** — SQL-Dateien öffnen
- **TOAD-0037** — Dateien speichern
- **TOAD-0038** — Datenbankobjekte in den Editor laden
- **TOAD-0039** — Mehrere Editor-Tabs
- **TOAD-0040** — Zwischen Editor-Tabs wechseln
- **TOAD-0041** — Vollbildansicht des Editors
- **TOAD-0042** — Aktuelles Schema umschalten
- **TOAD-0043** — Lesezeichen setzen und anspringen
- **TOAD-0044** — Dateiübergreifende Textsuche
- **TOAD-0045** — Automatische Editor-Sicherung
- **TOAD-0046** — Externen Editor verwenden
- **TOAD-0047** — Ergebnisbereich im Editor
- **TOAD-0048** — Separates Ausgabefenster

<a id="g07"></a>

### 07. Editor: Suchen und Ersetzen

Modul: **K** · Nachweis: **D26** · 18 Punkte.

Quellen: [FIND: Getting Started 2026 R1 – Find and Replace](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/8).

- **TOAD-0049** — Textsuche
- **TOAD-0050** — Groß-/Kleinschreibung berücksichtigen
- **TOAD-0051** — Nur ganze Wörter suchen
- **TOAD-0052** — Reguläre Ausdrücke
- **TOAD-0053** — Vorwärts und rückwärts suchen
- **TOAD-0054** — Markierten Text als Suchbegriff übernehmen
- **TOAD-0055** — Wort unter Cursor als Suchbegriff übernehmen
- **TOAD-0056** — Suchhistorie während der Sitzung
- **TOAD-0057** — Text ersetzen
- **TOAD-0058** — Alle Treffer ersetzen
- **TOAD-0059** — Escape-Sequenzen beim Ersetzen interpretieren
- **TOAD-0060** — Alle Suchtreffer hervorheben
- **TOAD-0061** — Nächsten Treffer anspringen
- **TOAD-0062** — Vorherigen Treffer anspringen
- **TOAD-0063** — Direkt zu Zeilennummer springen
- **TOAD-0064** — Such-/Ersetzungs-Makros speichern
- **TOAD-0065** — Such-/Ersetzungs-Makros wiederverwenden
- **TOAD-0066** — Mehrere Dateisuchen gleichzeitig

<a id="g08"></a>

### 08. Codevorlagen und Einfügehilfen

Modul: **K** · Nachweis: **D26** · 7 Punkte.

Quellen: [TPL: Getting Started 2026 R1 – Code Completion Templates](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/write-statements-and-scripts/use-the-object-palette).

- **TOAD-0067** — Codevorlagen speichern
- **TOAD-0068** — Vorlagen über Kürzel auswählen
- **TOAD-0069** — Mehrzeilige Vorlagen
- **TOAD-0070** — Substitutionsvariablen in Vorlagen
- **TOAD-0071** — Cursorposition in Vorlagen vorgeben
- **TOAD-0072** — Vorlagen über Ctrl+Space einfügen
- **TOAD-0073** — Objektpalette als Einfügehilfe

<a id="g09"></a>

### 09. Snippets und Codevervollständigung

Modul: **K** · Nachweis: **D26** · 9 Punkte.

Quellen: [SNP: Getting Started 2026 R1 – Snippets und Code Insight](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/25).

- **TOAD-0074** — Eigene Codesnippets
- **TOAD-0075** — Snippet-Kategorien
- **TOAD-0076** — Beschreibungen für Snippets
- **TOAD-0077** — Snippets bearbeiten
- **TOAD-0078** — Snippets per Doppelklick einfügen
- **TOAD-0079** — Snippets per Drag-and-drop einfügen
- **TOAD-0080** — Snippet im Editor hervorheben
- **TOAD-0081** — Code-Insight-Auswahlliste
- **TOAD-0082** — Codevervollständigung per Tastatur

<a id="g10"></a>

### 10. Code bearbeiten und aufbereiten

Modul: **K** · Nachweis: **D26** · 12 Punkte.

Quellen: [WRITE: Getting Started 2026 R2 – dokumentierte Editorfunktionen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/34).

Hinweis: Die Seite führt diese Funktionen im Handbuch-Inhaltsverzeichnis auf; einzelne Formatter- und Refactoring-Regeln sind damit nicht vollständig auditiert.

- **TOAD-0083** — Code Navigator
- **TOAD-0084** — SQL-Abfragevorlagen
- **TOAD-0085** — Code formatieren
- **TOAD-0086** — Statements hervorheben
- **TOAD-0087** — Codeblöcke ein-/ausklappen
- **TOAD-0088** — Groß-/Kleinschreibung umwandeln
- **TOAD-0089** — Zeile mit vorheriger Zeile tauschen
- **TOAD-0090** — Abfrageergebnisse vorab ansehen
- **TOAD-0091** — Codestatistik anzeigen
- **TOAD-0092** — Make-Code-Vorlagen definieren
- **TOAD-0093** — SQL für Entwicklungswerkzeuge aufbereiten
- **TOAD-0094** — Anwendungsseitige Stringhüllen mit Strip Code entfernen

<a id="g11"></a>

### 11. SQL ausführen und Skripte verwalten

Modul: **K** · Nachweis: **D26** · 7 Punkte.

Quellen: [RUN: Getting Started 2026 R1 – Skriptausführung](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/30).

Hinweis: Statement-Ausführung und Skriptausführung unterscheiden sich bei Bind-Variablen, Fetching und Editierbarkeit.

- **TOAD-0095** — Einzelnes Statement ausführen
- **TOAD-0096** — Skript im Editor ausführen
- **TOAD-0097** — SQL*Plus als externen Runner starten
- **TOAD-0098** — Lange Skripte im Toad Script Runner
- **TOAD-0099** — Mehrere Skripte über Script Manager
- **TOAD-0100** — Skriptausführung über Automation Designer
- **TOAD-0101** — SQL-Ergebnis in Zwischenablage übernehmen

<a id="g12"></a>

### 12. SQL-Historie und PL/SQL-Arbeit

Modul: **K** · Nachweis: **D26** · 10 Punkte.

Quellen: [PL: Getting Started 2026 R1 – PL/SQL-Objekte und SQL Recall](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/work-with-plsql-objects/reload-object).

- **TOAD-0102** — SQL-Historie wiederverwenden
- **TOAD-0103** — Gespeicherte SQL-Statements importieren/exportieren
- **TOAD-0104** — Datenbankcode erneut laden
- **TOAD-0105** — Neue PL/SQL-Objekte aus Vorlagen
- **TOAD-0106** — Eigene PL/SQL-Objektvorlagen
- **TOAD-0107** — Vorlagen mit Schlüsselwortersetzung
- **TOAD-0108** — Prozeduren extrahieren
- **TOAD-0109** — DBMS_OUTPUT-Aufrufe generieren
- **TOAD-0110** — Einzelnes SQL innerhalb von PL/SQL ausführen
- **TOAD-0111** — PL/SQL mit Parametern ausführen

<a id="g13"></a>

### 13. Query Builder

Modul: **K** · Nachweis: **D26** · 24 Punkte.

Quellen: [QB: Getting Started 2026 R1 – grafischer Query Builder](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/29).

- **TOAD-0112** — Tabellen ins Abfragemodell ziehen
- **TOAD-0113** — Views ins Abfragemodell ziehen
- **TOAD-0114** — Synonyme ins Abfragemodell ziehen
- **TOAD-0115** — SELECT-Spalten per Checkbox
- **TOAD-0116** — Joins per Drag-and-drop
- **TOAD-0117** — WHERE-Bedingungen grafisch
- **TOAD-0118** — GROUP-BY-Zuordnung
- **TOAD-0119** — HAVING-Bedingungen
- **TOAD-0120** — ORDER-BY-Zuordnung
- **TOAD-0121** — Abfragemodell speichern
- **TOAD-0122** — Generiertes SQL bearbeiten
- **TOAD-0123** — Diagrammänderungen nach SQL übertragen
- **TOAD-0124** — SQL-Änderungen ins Diagramm übertragen
- **TOAD-0125** — Unterabfragen in WHERE
- **TOAD-0126** — Unterabfragen in FROM
- **TOAD-0127** — Verschachtelte Unterabfragen
- **TOAD-0128** — EXISTS-Unterabfragen
- **TOAD-0129** — NOT-EXISTS-Unterabfragen
- **TOAD-0130** — Benannte Unterabfragen
- **TOAD-0131** — Inline Views
- **TOAD-0132** — AND-/OR-Verknüpfungen
- **TOAD-0133** — Globaler WHERE-Ausdruck
- **TOAD-0134** — Expertenmodus für Bedingungen
- **TOAD-0135** — Outer-Join-Einstellungen

<a id="g14"></a>

### 14. PL/SQL-Debugger

Modul: **K** · Nachweis: **D26** · 10 Punkte.

Quellen: [DBG: Getting Started 2026 R1 – Debugger starten und parametrisieren](https://support.quest.com/fr-fr/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/35).

- **TOAD-0136** — Mit Debug-Informationen kompilieren
- **TOAD-0137** — PL/SQL im Debugger ausführen
- **TOAD-0138** — Step Into
- **TOAD-0139** — Step Over
- **TOAD-0140** — Bis zur Cursorposition ausführen
- **TOAD-0141** — Aufrufparameter setzen
- **TOAD-0142** — Ausdrücke als Parameterwerte
- **TOAD-0143** — Funktionsresultate als Parameterwerte
- **TOAD-0144** — SELECT-Ergebnisse als Parameterwerte
- **TOAD-0145** — Debug-Informationen für Produktion entfernen

<a id="g15"></a>

### 15. Debugger: Haltepunkte und Zustandsinspektion

Modul: **K** · Nachweis: **D26** · 10 Punkte.

Quellen: [WATCH: Getting Started 2026 R1 – Watches](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/41).

Hinweis: Ein Teil dieser Punkte ist über die Kapitelstruktur des Handbuchs belegt; sämtliche Debugger-Dialogoptionen sind nicht einzeln geprüft.

- **TOAD-0146** — Variablen mit Watches beobachten
- **TOAD-0147** — Smart Watches
- **TOAD-0148** — Watch-Fensteranordnung ändern
- **TOAD-0149** — Call Stack anzeigen
- **TOAD-0150** — Trigger-Parameter konfigurieren
- **TOAD-0151** — Abhängigkeiten beim Debuggen behandeln
- **TOAD-0152** — Debug-Ergebnisse anzeigen
- **TOAD-0153** — Debugger stoppen
- **TOAD-0154** — Skripte debuggen
- **TOAD-0155** — Skript-Ausgabe untersuchen

<a id="g16"></a>

### 16. Haltepunkte und DBMS Output

Modul: **K** · Nachweis: **D26** · 6 Punkte.

Quellen: [BREAK: Getting Started 2026 R1 – Breakpoints und Debug-Kapitel](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/40).

- **TOAD-0156** — Haltepunkt am Editorrand setzen
- **TOAD-0157** — Haltepunkt per Tastenkürzel setzen
- **TOAD-0158** — Haltepunkt wieder entfernen
- **TOAD-0159** — DBMS Output aktivieren
- **TOAD-0160** — DBMS Output anzeigen
- **TOAD-0161** — DBMS Output bearbeiten

<a id="g17"></a>

### 17. PL/SQL-Profiling

Modul: **K / Oracle-Pakete** · Nachweis: **D26** · 19 Punkte.

Quellen: [PROF: Getting Started 2026 R1 – Profiler](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/43).

- **TOAD-0162** — Zeilenprofiling über DBMS_PROFILER
- **TOAD-0163** — Hierarchisches Profiling über DBMS_HPROF
- **TOAD-0164** — Profiling gezielt ein-/ausschalten
- **TOAD-0165** — Profiler-Läufe speichern und untersuchen
- **TOAD-0166** — Läufe nach Programmeinheiten aufklappen
- **TOAD-0167** — Gesamtlaufzeit je Programmeinheit
- **TOAD-0168** — Ausführungsanzahl je Codezeile
- **TOAD-0169** — Gesamtzeit je Codezeile
- **TOAD-0170** — Minimale Zeit je Codezeile
- **TOAD-0171** — Maximale Zeit je Codezeile
- **TOAD-0172** — Zeitanteile grafisch darstellen
- **TOAD-0173** — Vom Profiler zur Quellcodezeile springen
- **TOAD-0174** — Unterprogrammaufrufe hierarchisch anzeigen
- **TOAD-0175** — Ausgeführte Zeilen im Editor markieren
- **TOAD-0176** — Nicht ausgeführte Zeilen markieren
- **TOAD-0177** — Anonyme Blöcke optional anzeigen
- **TOAD-0178** — Systeminterne Aufrufe optional anzeigen
- **TOAD-0179** — Profiler-Ergebnisse nach Mustern filtern
- **TOAD-0180** — Einzelne Profiler-Filter ein-/ausschalten

<a id="g18"></a>

### 18. Dateivergleich und Merge

Modul: **K** · Nachweis: **D26** · 7 Punkte.

Quellen: [DIFF: Getting Started 2026 R1 – Compare Files](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/write-statements-and-scripts/save-query-results).

- **TOAD-0181** — Dateien vergleichen
- **TOAD-0182** — SQL-Skripte vergleichen
- **TOAD-0183** — Datenbankobjekt mit VCS-Revision vergleichen
- **TOAD-0184** — Zwei Quellansichten nebeneinander
- **TOAD-0185** — Dritte bearbeitbare Merge-Ansicht
- **TOAD-0186** — Vergleichsansicht konfigurieren
- **TOAD-0187** — Zusammengeführten Quelltext bearbeiten

<a id="g19"></a>

### 19. Schema Browser: Navigation

Modul: **K / teilweise DBA** · Nachweis: **D26** · 18 Punkte.

Quellen: [SB: Getting Started 2026 R1 – Schema Browser](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/10).

- **TOAD-0188** — Schema auswählen
- **TOAD-0189** — Nach Objekttyp navigieren
- **TOAD-0190** — Objektliste und Detailansicht
- **TOAD-0191** — Spaltendetails einer Tabelle
- **TOAD-0192** — Indexdetails einer Tabelle
- **TOAD-0193** — Partitions-/Subpartitionsdetails
- **TOAD-0194** — Objektberechtigungen anzeigen
- **TOAD-0195** — Tabellendaten im Detailbereich
- **TOAD-0196** — Mehrere Objekte auswählen
- **TOAD-0197** — Objekte kompilieren
- **TOAD-0198** — Objektcode in Editor übernehmen
- **TOAD-0199** — Objektcode in Zwischenablage übernehmen
- **TOAD-0200** — Trigger einer Tabelle deaktivieren
- **TOAD-0201** — Trigger eines Schemas deaktivieren
- **TOAD-0202** — Team-Coding-Status im Browser
- **TOAD-0203** — Symbollegende
- **TOAD-0204** — Browser automatisch bei Anmeldung öffnen
- **TOAD-0205** — Aktives Dataset automatisch aktualisieren

<a id="g20"></a>

### 20. Schema Browser: Filter

Modul: **K / teilweise DBA** · Nachweis: **D26** · 8 Punkte.

Quellen: [SBF: Getting Started 2026 R1 – Schema-Filter](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/11).

Hinweis: Ein vollständiges Verzeichnis aller Filterfelder erfordert die installierte Hilfe.

- **TOAD-0206** — Objektfilter definieren
- **TOAD-0207** — Filter je Objekttyp
- **TOAD-0208** — Default-Filter
- **TOAD-0209** — Filter als SBFILT-Datei speichern
- **TOAD-0210** — Gespeicherte Filter laden
- **TOAD-0211** — Schnellfilter auf Objektlisten
- **TOAD-0212** — Filter für einzelnen Objekttyp löschen
- **TOAD-0213** — Filter aller Objekttypen löschen

<a id="g21"></a>

### 21. Objekte finden und beschreiben

Modul: **K / teilweise DBA** · Nachweis: **D26** · 9 Punkte.

Quellen: [OBJ: Getting Started 2026 R1 – Object Search](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/18).

- **TOAD-0214** — Objekte mit Describe untersuchen
- **TOAD-0215** — Suche nach Objektnamen
- **TOAD-0216** — Suche nach Spaltennamen
- **TOAD-0217** — Suche in gespeichertem Quellcode
- **TOAD-0218** — Suche über mehrere Schemas
- **TOAD-0219** — Suche nach Objektstatus eingrenzen
- **TOAD-0220** — Suche auf Objekttypen begrenzen
- **TOAD-0221** — Objekte in anderes Schema kopieren
- **TOAD-0222** — Gleichnamige Objekte anhand Schema und Typ unterscheiden

<a id="g22"></a>

### 22. Objekte erstellen und ändern

Modul: **K / teilweise DBA** · Nachweis: **D26** · 9 Punkte.

Quellen: [DDL: Getting Started 2026 R1 – Create/Alter Objects](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/19).

- **TOAD-0223** — Objekte über Eigenschaftsdialoge erstellen
- **TOAD-0224** — Objekte über Eigenschaftsdialoge ändern
- **TOAD-0225** — Oracle-Objektparameter auswählen
- **TOAD-0226** — DDL vor Ausführung anzeigen
- **TOAD-0227** — DDL direkt ausführen
- **TOAD-0228** — Objekte beim Erstellen zum Projekt hinzufügen
- **TOAD-0229** — Objekte umbenennen, soweit Oracle erlaubt
- **TOAD-0230** — Bestehendes Objekt als Vorlage verwenden
- **TOAD-0231** — Vorlagenobjekt vor Erstellung anpassen

<a id="g23"></a>

### 23. Dokumentierte Oracle-Objektfamilien

Modul: **K / teilweise DBA** · Nachweis: **D26** · 32 Punkte.

Quellen: [G: Getting Started 2026 R1, PDF](https://support-public.cfm.quest.com/82278_ToadForOracle_2026_R1_UserGuide.pdf).

Hinweis: Dieser Block zählt die Unterstützung beziehungsweise Auffindbarkeit je Objektfamilie. Er behauptet keine identischen Create/Alter/Drop-Operationen für jeden Typ. Insbesondere Object Search benötigt für zahlreiche Admin-Typen das DB Admin Module.

- **TOAD-0232** — Tabellen
- **TOAD-0233** — Views
- **TOAD-0234** — Materialized Views
- **TOAD-0235** — Indizes
- **TOAD-0236** — Constraints
- **TOAD-0237** — Prozeduren
- **TOAD-0238** — Funktionen
- **TOAD-0239** — Packages
- **TOAD-0240** — Trigger
- **TOAD-0241** — Benutzer
- **TOAD-0242** — Rollen
- **TOAD-0243** — Kontexte
- **TOAD-0244** — Dimensionen
- **TOAD-0245** — Directory-Objekte
- **TOAD-0246** — Evaluation Contexts
- **TOAD-0247** — Libraries
- **TOAD-0248** — Operatoren
- **TOAD-0249** — Policies
- **TOAD-0250** — Policy Groups
- **TOAD-0251** — Profile
- **TOAD-0252** — Refresh Groups
- **TOAD-0253** — Resource Plans
- **TOAD-0254** — Rules
- **TOAD-0255** — Rule Sets
- **TOAD-0256** — Scheduler Chains
- **TOAD-0257** — Scheduler Jobs
- **TOAD-0258** — Scheduler Job Classes
- **TOAD-0259** — Scheduler Programs
- **TOAD-0260** — Scheduler Schedules
- **TOAD-0261** — Scheduler Windows
- **TOAD-0262** — Scheduler Window Groups
- **TOAD-0263** — Tablespaces

<a id="g24"></a>

### 24. Fremdschlüssel und relationale Navigation

Modul: **K** · Nachweis: **D26** · 12 Punkte.

Quellen: [FK: Getting Started 2026 R1 – Foreign Key Lookup](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/20).

- **TOAD-0264** — Referenzierte Datensätze per Lookup öffnen
- **TOAD-0265** — Fremdschlüsselwerte aus Referenztabelle übernehmen
- **TOAD-0266** — FK-Lookup auch im Lesemodus
- **TOAD-0267** — Deaktivierte Constraints optional ignorieren
- **TOAD-0268** — Lookup durch Tippen filtern
- **TOAD-0269** — Lookup-SQL bearbeiten
- **TOAD-0270** — Variablen im Lookup-SQL
- **TOAD-0271** — Lookup-Syntax prüfen
- **TOAD-0272** — FK-Lookup global deaktivieren
- **TOAD-0273** — Parent-/Child-Datasets anzeigen
- **TOAD-0274** — Objektprivilegien erstellen/ändern
- **TOAD-0275** — Berechtigungsempfänger konfigurieren

<a id="g25"></a>

### 25. Grid: Darstellung, Suche und Filter

Modul: **K** · Nachweis: **D26** · 16 Punkte.

Quellen: [GRID: Getting Started 2026 R1 – Data Grid Basics](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/data-grid-basics).

Hinweis: Clientfilter arbeiten auf geladenen Daten; Serverfilter begrenzen die vom Server abzurufenden Zeilen.

- **TOAD-0276** — Ergebnisdaten tabellarisch anzeigen
- **TOAD-0277** — Grid-Inhalte drucken
- **TOAD-0278** — Spalten fixieren
- **TOAD-0279** — Fixierung aufheben
- **TOAD-0280** — Spalten ein-/ausblenden
- **TOAD-0281** — Spaltenauswahl alphabetisch sortieren
- **TOAD-0282** — Daten sortieren
- **TOAD-0283** — Daten gruppieren
- **TOAD-0284** — Text im Grid suchen
- **TOAD-0285** — Inkrementelle Suche
- **TOAD-0286** — Clientseitige Ergebnisfilter
- **TOAD-0287** — Serverseitiger Filter/Sort im Schema Browser
- **TOAD-0288** — Ausgewählte Spalte in Vorschau
- **TOAD-0289** — Zeilennummern anzeigen
- **TOAD-0290** — ROWID anzeigen
- **TOAD-0291** — Spaltennamen kopieren

<a id="g26"></a>

### 26. Grid: Daten ändern und rechnen

Modul: **K** · Nachweis: **D26** · 12 Punkte.

Quellen: [EDITDATA: Getting Started 2026 R1 – Daten bearbeiten](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/17).

Hinweis: Post/Revert und Transaktions-Commit/Rollback sind unterschiedliche Schritte. Zellberechnungen gelten für zusammenhängende Auswahl.

- **TOAD-0292** — Zellen editierbarer Ergebnisse ändern
- **TOAD-0293** — Leere Zeile einfügen
- **TOAD-0294** — Vorhandene Zeile duplizieren
- **TOAD-0295** — Zeile löschen
- **TOAD-0296** — Grid-Änderungen posten
- **TOAD-0297** — Ungepostete Grid-Änderungen verwerfen
- **TOAD-0298** — Große Zellwerte im Popup-Editor
- **TOAD-0299** — Summe markierter Zellen
- **TOAD-0300** — Mittelwert markierter Zellen
- **TOAD-0301** — Anzahl markierter Zellen
- **TOAD-0302** — Berechnungszeile unter dem Grid
- **TOAD-0303** — Taschenrechner in numerischen Zellen

<a id="g27"></a>

### 27. Editierbare Abfragen und Datenkopie

Modul: **K / Maskierung Pro** · Nachweis: **D26** · 11 Punkte.

Quellen: [COPY: Getting Started 2026 R1 – Copy Data](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/15).

Hinweis: Die Zieltabelle muss beim hier beschriebenen Kopierverfahren bereits existieren.

- **TOAD-0304** — Editierbare SELECT-Ergebnisse mittels ROWID
- **TOAD-0305** — EDIT-Kurzschreibweise für Tabellen
- **TOAD-0306** — Read-only-Abfragen als Option
- **TOAD-0307** — Tabellendaten in anderes Schema kopieren
- **TOAD-0308** — Tabellendaten in andere Datenbank kopieren
- **TOAD-0309** — Mehrere Tabellen gemeinsam kopieren
- **TOAD-0310** — Array Binding bei Datenkopie
- **TOAD-0311** — Array-Größe konfigurieren
- **TOAD-0312** — WHERE-Einschränkung je Tabelle
- **TOAD-0313** — WHERE-Klauseln vorab testen
- **TOAD-0314** — Daten beim Kopieren maskieren

<a id="g28"></a>

### 28. Datenvergleich und Synchronisierung

Modul: **K / Mehrtabellenumfang editionsabhängig** · Nachweis: **D26** · 15 Punkte.

Quellen: [DC: Getting Started 2026 R1 – Compare Data](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/16).

- **TOAD-0315** — Daten zwischen Schemas vergleichen
- **TOAD-0316** — Daten zwischen Datenbanken vergleichen
- **TOAD-0317** — Vergleich über Datenbanklink
- **TOAD-0318** — Quelle und Ziel vertauschen
- **TOAD-0319** — Quelle per WHERE filtern
- **TOAD-0320** — Ziel per WHERE filtern
- **TOAD-0321** — WHERE von Quelle zu Ziel übernehmen
- **TOAD-0322** — Optimizer-Hints für Vergleich
- **TOAD-0323** — Parallelitätsgrad einstellen
- **TOAD-0324** — Sort Area Size einstellen
- **TOAD-0325** — Vergleichsspalten auswählen
- **TOAD-0326** — Synchronisierungsskript erzeugen
- **TOAD-0327** — Synchronisierungsskript speichern
- **TOAD-0328** — Synchronisierungsskript im Editor nachbearbeiten
- **TOAD-0329** — Synchronisierung ausführen

<a id="g29"></a>

### 29. Datenvergleich: Schlüssel und Differenzen

Modul: **K** · Nachweis: **H** · 12 Punkte.

Quellen: [DCK: Getting Started 2025 R1 – Vergleichsdetails](https://support.quest.com/technical-documents/toad-for-oracle/2025%20r1/getting-started-guide/work-with-data/compare-data).

- **TOAD-0330** — Primärschlüssel automatisch erkennen
- **TOAD-0331** — Vergleichsschlüssel manuell wählen
- **TOAD-0332** — Zusammengesetzte Vergleichsschlüssel
- **TOAD-0333** — Fehlende Schlüssel melden
- **TOAD-0334** — Nicht vergleichbare Spalten melden
- **TOAD-0335** — Nicht kompatible Datentypen melden
- **TOAD-0336** — Geänderte Zeilen anhand Schlüssel erkennen
- **TOAD-0337** — Ohne Schlüssel komplette Zeilen vergleichen
- **TOAD-0338** — Nur in Quelle vorhandene Zeilen erkennen
- **TOAD-0339** — Nur in Ziel vorhandene Zeilen erkennen
- **TOAD-0340** — Übereinstimmende Zeilen erkennen
- **TOAD-0341** — Daten-Duplikatvergleich

<a id="g30"></a>

### 30. Objekt- und Schemavergleich

Modul: **K / Synchronisierung DBA oder passende Edition** · Nachweis: **D26** · 20 Punkte.

Quellen: [SC: Getting Started 2026 R1 – Object/Schema Compare](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/21).

- **TOAD-0342** — Einzelne Schemaobjekte vergleichen
- **TOAD-0343** — Nicht-schemaweite Datenbankobjekte vergleichen
- **TOAD-0344** — Auswahl mehrerer Objekte vergleichen
- **TOAD-0345** — Verbundene Objekte einbeziehen
- **TOAD-0346** — Tabellentrigger einbeziehen
- **TOAD-0347** — DDL nebeneinander vergleichen
- **TOAD-0348** — Spaltenvergleich
- **TOAD-0349** — Spalten alphabetisch vergleichen
- **TOAD-0350** — Precision/Scale berücksichtigen
- **TOAD-0351** — Versteckte Spalten berücksichtigen
- **TOAD-0352** — Objekt-Synchronisierungsskript
- **TOAD-0353** — Skript in Zwischenablage übernehmen
- **TOAD-0354** — Live-Schemas vergleichen
- **TOAD-0355** — Snapshot-Dateien vergleichen
- **TOAD-0356** — Schema-Snapshots erzeugen
- **TOAD-0357** — Objekttypen vom Vergleich ausschließen
- **TOAD-0358** — Differenzdetails exportieren
- **TOAD-0359** — Differenzzusammenfassung exportieren
- **TOAD-0360** — Ausgabeordner je Schemapaar
- **TOAD-0361** — DBMS_REDEFINITION bei Tabellenreihenfolge nutzen

<a id="g31"></a>

### 31. Datenbankvergleich und Rebuild

Modul: **DBA / teilweise K** · Nachweis: **D26** · 15 Punkte.

Quellen: [REBUILD: Getting Started 2026 R1 – Datenbankvergleich und Rebuild](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/22).

- **TOAD-0362** — Datenbankdefinitionen vergleichen
- **TOAD-0363** — Datenbank-Snapshots als Vergleichsquelle
- **TOAD-0364** — Datenbank-Synchronisierungsskript
- **TOAD-0365** — Vergleichsergebnis als HTML
- **TOAD-0366** — Einzelne Änderungen vom Sync ausschließen
- **TOAD-0367** — Tabellen-Rebuild
- **TOAD-0368** — Index-Rebuild
- **TOAD-0369** — Mehrere Objekte gemeinsam rebuilden
- **TOAD-0370** — Spalten beim Tabellen-Rebuild ändern
- **TOAD-0371** — Tabellenparameter beim Rebuild ändern
- **TOAD-0372** — Indexparameter beim Rebuild ändern
- **TOAD-0373** — Rebuild-Skript ansehen
- **TOAD-0374** — Rebuild-Skript bearbeiten
- **TOAD-0375** — Rebuild-Skript speichern
- **TOAD-0376** — Rebuild ausführen

<a id="g32"></a>

### 32. Exportformate und Exportwege

Modul: **K / Maskierung Pro / Data Pump DBA** · Nachweis: **H** · 27 Punkte.

Quellen: [EXP: Quest: Exportmöglichkeiten von Toad for Oracle](https://blog.quest.com/product-post/so-you-want-to-export-data-from-oracle-let-s-count-the-ways/).

Hinweis: ODBC-Export ist keine allgemeine Multi-DB-Abfragefunktion von Toad for Oracle.

- **TOAD-0377** — Delimited Text / CSV
- **TOAD-0378** — Excel-Datei
- **TOAD-0379** — HTML-Tabelle
- **TOAD-0380** — INSERT-Statements
- **TOAD-0381** — MERGE-Statements
- **TOAD-0382** — JSON
- **TOAD-0383** — XML
- **TOAD-0384** — SQL*Loader-Ausgabe
- **TOAD-0385** — Export über ODBC-Verbindung
- **TOAD-0386** — Export aus Schema Browser
- **TOAD-0387** — Export aus Query Builder
- **TOAD-0388** — Export aus Editor-Ergebnis
- **TOAD-0389** — Mehrere Tabellen gemeinsam exportieren
- **TOAD-0390** — Exportdaten maskieren
- **TOAD-0391** — Data-Pump-Exportassistent
- **TOAD-0392** — Data-Pump-Modus Tabellen
- **TOAD-0393** — Data-Pump-Modus Schemas
- **TOAD-0394** — Data-Pump-Modus Tablespaces
- **TOAD-0395** — Data-Pump-Modus Datenbank
- **TOAD-0396** — Transportable-Tablespaces-Export
- **TOAD-0397** — Data-Pump-Objekte ein-/ausschließen
- **TOAD-0398** — Data-Pump-Abfragefilter
- **TOAD-0399** — Data-Pump-Parameter konfigurieren
- **TOAD-0400** — Data-Pump-Dateiziel konfigurieren
- **TOAD-0401** — ER-Diagramm aus gewählter Tabelle
- **TOAD-0402** — FK-Beziehungstiefe im ER-Diagramm wählen
- **TOAD-0403** — ER-Diagramm an Query Builder übergeben

<a id="g33"></a>

### 33. Excel-Export: kleine Optionen

Modul: **K / Windows-Integration** · Nachweis: **H** · 3 Punkte.

Quellen: [XLS: Quest KB: Export in Excel-Datei oder laufende Instanz](https://support.quest.com/toad-for-oracle/kb/4217693/como-exportar-datos-desde-toad-a-excel).

- **TOAD-0404** — Direkt in laufende Excel-Instanz exportieren
- **TOAD-0405** — Export an aktiver Excel-Zelle beginnen
- **TOAD-0406** — Grid-Auswahl in Excel einfügen

<a id="g34"></a>

### 34. Excel-Dateidetails

Modul: **K** · Nachweis: **H** · 2 Punkte.

Quellen: [XLS2: Quest KB: XLSX-Export](https://support.quest.com/toad-for-oracle/kb/4317319/how-to-save-the-export-data-grid-results-of-a-select-statement-or-query-into-an-excel-2007-file).

- **TOAD-0407** — XLS-Export
- **TOAD-0408** — XLSX-Export

<a id="g35"></a>

### 35. Exportüberschriften

Modul: **K** · Nachweis: **H** · 1 Punkte.

Quellen: [XLS3: Quest KB: Spaltenüberschriften beim Excel-Export](https://support.quest.com/toad-for-oracle/kb/4308429/when-i-export-my-query-data-results-to-excel-file-i-am-unable-to-include-column-name-headers).

- **TOAD-0409** — Spaltenüberschriften im Export ein-/ausschließen

<a id="g36"></a>

### 36. Arbeitsblattnamen

Modul: **K** · Nachweis: **H** · 1 Punkte.

Quellen: [XLS4: Quest KB: Excel Sheet Name](https://support.quest.com/kb/4290479/export-dataset-to-an-excel-file-how-to-change-or-give-a-custom-name-to-the-sheet-name-where-the-data-goes-into-).

- **TOAD-0410** — Excel-Arbeitsblattnamen vorgeben

<a id="g37"></a>

### 37. Export: Kompression und Dateiverhalten

Modul: **K** · Nachweis: **H** · 8 Punkte.

Quellen: [R17: 17.0 – Release Notes](https://support.quest.com/technical-documents/toad-for-oracle/17.0/release-notes).

- **TOAD-0411** — 7-Zip-Kompression
- **TOAD-0412** — gzip-Kompression
- **TOAD-0413** — Zeilenende bei Flat-File-Export wählen
- **TOAD-0414** — Bei gesperrter Excel-Datei erneut versuchen
- **TOAD-0415** — Excel-Formeln beim Export zulassen
- **TOAD-0416** — Exportabfrage ohne Grid-Anzeige abbrechen
- **TOAD-0417** — Mehrere Grid-Zellen gleichzeitig einfügen
- **TOAD-0418** — Mehrspaltige Gridsortierung

<a id="g38"></a>

### 38. Tabellenimport

Modul: **K** · Nachweis: **H** · 10 Punkte.

Quellen: [IMP: Quest KB: Import Table Data](https://support.quest.com/toad-for-oracle/kb/4335213/import-excel-file-into-oracle-using-toad).

- **TOAD-0419** — Excel-Daten importieren
- **TOAD-0420** — Importziel aus Schema und Objekt auswählen
- **TOAD-0421** — Zieldaten vor Import anzeigen
- **TOAD-0422** — Datenformate konfigurieren
- **TOAD-0423** — Spaltenzuordnung prüfen
- **TOAD-0424** — Automatisches Spaltenmapping
- **TOAD-0425** — Manuelles Spaltenmapping
- **TOAD-0426** — Importmodus wählen
- **TOAD-0427** — Commit-Verhalten beim Import wählen
- **TOAD-0428** — Importvorschau/Zusammenfassung

<a id="g39"></a>

### 39. Textimport und SQL*Loader

Modul: **K / Oracle-Utilities** · Nachweis: **H** · 5 Punkte.

Quellen: [LOAD: Quest: Toad for Oracle General Q&A](https://blog.toadworld.com/toad-for-oracle-general-qa).

Hinweis: SQL*Loader benötigt das entsprechende Oracle-Client-Werkzeug.

- **TOAD-0429** — CSV-Daten importieren
- **TOAD-0430** — Tab-getrennte Dateien importieren
- **TOAD-0431** — SQL*Loader-Assistent
- **TOAD-0432** — SQL*Loader-Control-Datei erstellen
- **TOAD-0433** — SQL*Loader aus Toad starten

<a id="g40"></a>

### 40. Testdaten und Codequalität

Modul: **Pro** · Nachweis: **H** · 15 Punkte.

Quellen: [QUAL: Quest: Code Review und Qualitätsmetriken](https://blog.quest.com/product-post/toad-code-review-useful-to-the-programmer/).

- **TOAD-0434** — Code Analysis für einzelne Programmeinheiten
- **TOAD-0435** — Code Analysis für Packages
- **TOAD-0436** — Code aus Dateisystem prüfen
- **TOAD-0437** — Code aus Datenbank prüfen
- **TOAD-0438** — Prüfregeln anzeigen
- **TOAD-0439** — Prüfregeln bearbeiten
- **TOAD-0440** — Code-Review-Bericht speichern
- **TOAD-0441** — CRUD-Zugriffe im Code ausweisen
- **TOAD-0442** — Toad-Code-Rating
- **TOAD-0443** — Halstead-Komplexitätsmetrik
- **TOAD-0444** — McCabe Cyclomatic Complexity
- **TOAD-0445** — Maintainability Index
- **TOAD-0446** — SQL-Komplexität klassifizieren
- **TOAD-0447** — Problematisches SQL kennzeichnen
- **TOAD-0448** — Ungültiges SQL kennzeichnen

<a id="g41"></a>

### 41. Testdatengenerator

Modul: **Pro** · Nachweis: **H** · 5 Punkte.

Quellen: [GEN: Quest: Developer Evaluation Guide 2021 R1](https://www.quest.com/documents/toad-for-oracle-trial-evaluation-matrix-developer-datasheet-149194.pdf).

Hinweis: Eine vollständige Liste der Generatoren, Verteilungen und Parameter liegt für 2026 R2 nicht vor.

- **TOAD-0449** — Zufallsdaten erzeugen
- **TOAD-0450** — Realitätsnahe Testdaten erzeugen
- **TOAD-0451** — Einzelne Tabelle befüllen
- **TOAD-0452** — Tabellengruppen befüllen
- **TOAD-0453** — Testdatenmaskierung

<a id="g42"></a>

### 42. utPLSQL-Unit-Tests

Modul: **K / installiertes utPLSQL** · Nachweis: **D26** · 19 Punkte.

Quellen: [UT: Getting Started 2026 R1 – Create Unit Tests](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/create-unit-tests).

- **TOAD-0454** — Testsuite grafisch anlegen
- **TOAD-0455** — Tests zu bestehender Suite hinzufügen
- **TOAD-0456** — Suites über Suite-Pfade gruppieren
- **TOAD-0457** — Suite-Beschreibung
- **TOAD-0458** — Package-Spezifikation und Body voranzeigen
- **TOAD-0459** — Setup-/Teardown-Stubs erzeugen
- **TOAD-0460** — Suite aktivieren/deaktivieren
- **TOAD-0461** — Einzeltest aktivieren/deaktivieren
- **TOAD-0462** — Mehrere Tests in einer Suite
- **TOAD-0463** — Testobjekt auswählen
- **TOAD-0464** — Erwarteten Wert definieren
- **TOAD-0465** — Vergleichsoperation wählen
- **TOAD-0466** — Erwartung als Ausdruck definieren
- **TOAD-0467** — Test aus Suite entfernen
- **TOAD-0468** — Testcode zum Editor übertragen
- **TOAD-0469** — Tests im Editor ausführen
- **TOAD-0470** — Tests im Unit Test Manager ausführen
- **TOAD-0471** — Tests aus realen Ausführungswerten erzeugen
- **TOAD-0472** — Tests aus Debug-Ausgaben erzeugen

<a id="g43"></a>

### 43. DBA: Monitoring, Statistiken und Diagnose

Modul: **DBA** · Nachweis: **H** · 23 Punkte.

Quellen: [D: DB Admin Module – Datenblatt](https://www.quest.com/documents/toad-for-oracle-db-admin-module-datasheet-146117.pdf).

Hinweis: DBA-Modul-Datenblatt; Oracle-Rechte und gegebenenfalls Oracle-Pack-Lizenzen bleiben Voraussetzungen.

- **TOAD-0473** — Database Monitor
- **TOAD-0474** — Logische I/O überwachen
- **TOAD-0475** — Physische I/O überwachen
- **TOAD-0476** — Wait Events beobachten
- **TOAD-0477** — Session-Aktivität überwachen
- **TOAD-0478** — Aufrufraten anzeigen
- **TOAD-0479** — Cache-Miss-Raten anzeigen
- **TOAD-0480** — SGA untersuchen
- **TOAD-0481** — Shared Pool untersuchen
- **TOAD-0482** — Indexnutzung überwachen
- **TOAD-0483** — Analyze All Objects
- **TOAD-0484** — Objektstatistiken sammeln
- **TOAD-0485** — Statistiken exportieren
- **TOAD-0486** — Statistiken importieren
- **TOAD-0487** — Statistiken zwischen Schemas kopieren
- **TOAD-0488** — Statistiken zwischen Datenbanken kopieren
- **TOAD-0489** — Alert Log anzeigen
- **TOAD-0490** — Trace-Dateien analysieren
- **TOAD-0491** — Session-Tracing einschalten
- **TOAD-0492** — StatsPack-Auswertung
- **TOAD-0493** — AWR-Auswertung
- **TOAD-0494** — Oracle-Advisories nutzen
- **TOAD-0495** — Oracle Data Pump ansteuern

<a id="g44"></a>

### 44. DBA: Health Checks und Speicherverwaltung

Modul: **DBA** · Nachweis: **H** · 18 Punkte.

Quellen: [E: DBA Evaluation Guide 2021 R1](https://www.quest.com/documents/toad-for-oracle-trial-evaluation-matrix-dba-datasheet-149193.pdf).

Hinweis: Die veröffentlichten Gesamtzahlen der Health-Checks unterscheiden sich nach Dokument/Version; keine aktuelle, vollständig enumerierte Regelliste belegt.

- **TOAD-0496** — Datenbank-Health-Checks
- **TOAD-0497** — Health-Check-Kategorien auswählen
- **TOAD-0498** — Health-Check-Einstellungen anpassen
- **TOAD-0499** — Health-Check-Läufe vergleichen
- **TOAD-0500** — Health-Check-Ergebnisse als HTML speichern
- **TOAD-0501** — Exadata-spezifische Prüfungen
- **TOAD-0502** — Tablespace-Wachstum verfolgen
- **TOAD-0503** — Tablespace-I/O verfolgen
- **TOAD-0504** — Speicherentwicklung prognostizieren
- **TOAD-0505** — Messwerte in Repository sammeln
- **TOAD-0506** — Messung über DBMS_JOB planen
- **TOAD-0507** — ASM Manager
- **TOAD-0508** — Segment Advisor
- **TOAD-0509** — Edition-Based Redefinition verwalten
- **TOAD-0510** — Redo LogMiner
- **TOAD-0511** — Undo-SQL aus Redo erzeugen
- **TOAD-0512** — Flashback-Werkzeuge
- **TOAD-0513** — Tabellen-Neudefinition

<a id="g45"></a>

### 45. Database Browser: Instanzübersicht

Modul: **K/teilweise DBA** · Nachweis: **H** · 8 Punkte.

Quellen: [DBB: Quest: Database Browser](https://blog.quest.com/product-post/how-to-monitor-database-activity-with-the-toad-database-browser-utility/).

- **TOAD-0514** — Mehrere Datenbanken im Database Browser organisieren
- **TOAD-0515** — Speicherinformationen anzeigen
- **TOAD-0516** — Instanzparameter anzeigen
- **TOAD-0517** — Datenbankoptionen anzeigen
- **TOAD-0518** — Sessions im Datenbankkontext anzeigen
- **TOAD-0519** — Rollback-Informationen anzeigen
- **TOAD-0520** — Aktivität als Diagramm darstellen
- **TOAD-0521** — Aktivität als Tabelle darstellen

<a id="g46"></a>

### 46. Oracle 23ai und neuere Objektdetails

Modul: **K/teilweise DBA** · Nachweis: **H** · 15 Punkte.

Quellen: [R25: 2025 R1 – Oracle-23ai-Unterstützung](https://support.quest.com/technical-documents/toad-for-oracle/2025%20r1/release-notes/new-features-and-enhancements).

Hinweis: Belegt in 2025 R1; abhängig von Oracle-Version. SQL Firewall gehört zum DB-Admin-Umfang.

- **TOAD-0522** — SQL Firewall verwalten
- **TOAD-0523** — Tablespaces verkleinern
- **TOAD-0524** — Logical Partition Tracking
- **TOAD-0525** — PDB-Hybrid-Read-only-Modus
- **TOAD-0526** — Intervallpartitionierung hybrider Tabellen
- **TOAD-0527** — Automatische Listpartitionierung hybrider Tabellen
- **TOAD-0528** — LOB-Segmente ohne Move umbenennen
- **TOAD-0529** — Gleichzeitigen Materialized-View-Refresh konfigurieren
- **TOAD-0530** — Read-only-Benutzer
- **TOAD-0531** — Dictionary Protection einstellen
- **TOAD-0532** — Unified Auditing je Spalte
- **TOAD-0533** — VECTOR-Datentyp
- **TOAD-0534** — Vektorindizes
- **TOAD-0535** — Staging-Tabellen
- **TOAD-0536** — Default-Bigfile-Einstellung

<a id="g47"></a>

### 47. Automatisierung: Abläufe und Bedingungen

Modul: **K/aktionsabhängig** · Nachweis: **H** · 7 Punkte.

Quellen: [AUTO: Quest: Automation Designer](https://blog.quest.com/product-post/using-automation-designer-for-everyday-tasks).

- **TOAD-0537** — Automation Designer
- **TOAD-0538** — Aktionen zu Apps zusammenstellen
- **TOAD-0539** — If/Then-Verzweigungen
- **TOAD-0540** — TNS Ping als Aktion
- **TOAD-0541** — SQL-Skripte als Aktion ausführen
- **TOAD-0542** — Erfolgs-E-Mail konfigurieren
- **TOAD-0543** — Fehler-E-Mail konfigurieren

<a id="g48"></a>

### 48. Automatisierung: Verbindungen und Unterabläufe

Modul: **K/aktionsabhängig** · Nachweis: **H** · 7 Punkte.

Quellen: [ITER: Quest-Entwickler: Automation Designer](https://forums.toadworld.com/t/execute-script-in-multiple-databases-automation-designer/61324).

- **TOAD-0544** — Connection Iterator
- **TOAD-0545** — Skripte über mehrere Datenbanken ausführen
- **TOAD-0546** — Iteratoren verschachteln
- **TOAD-0547** — Andere Automations-Apps aufrufen
- **TOAD-0548** — Unteraktionen ausführen
- **TOAD-0549** — Ausgabedateien je Datenbank erzeugen
- **TOAD-0550** — Aktiven Benutzernamen als Variable verwenden

<a id="g49"></a>

### 49. Automatisierung: Daten- und Datei-Iteratoren

Modul: **K/aktionsabhängig** · Nachweis: **H** · 4 Punkte.

Quellen: [QITER: Quest-Forum: Query Iterator](https://forums.toadworld.com/t/automation-designer-query-iterator-using-variable/40709).

- **TOAD-0551** — Query Iterator
- **TOAD-0552** — Abfragewerte als Aktionsvariablen verwenden
- **TOAD-0553** — File Iterator
- **TOAD-0554** — List Iterator

<a id="g50"></a>

### 50. Automatisierung: Zeitplanung und Skriptsammlungen

Modul: **K/Windows** · Nachweis: **H** · 3 Punkte.

Quellen: [CLI: Quest: Command-line automation](https://blog.quest.com/product-post/how-do-i-use-the-command-line-options-to-make-toad-do-something-every-night/).

- **TOAD-0555** — Automationsaufruf über Kommandozeile
- **TOAD-0556** — Ausführung über Windows-Aufgabenplanung
- **TOAD-0557** — Toad nach Automationsausführung schließen

<a id="g51"></a>

### 51. Script Manager und Batch Jobs

Modul: **K/teilweise DBA** · Nachweis: **H** · 7 Punkte.

Quellen: [SCRIPTS: Quest: Batch Jobs](https://blog.quest.com/product-post/how-to-schedule-batch-jobs-in-toad-for-oracle-pro-db-admin/).

- **TOAD-0558** — Script Manager
- **TOAD-0559** — Skripte in Sammlungsdatei verwalten
- **TOAD-0560** — Skripte zur Sammlung hinzufügen
- **TOAD-0561** — Skripte aus Sammlung entfernen
- **TOAD-0562** — Ausgewählte Skripte sequenziell ausführen
- **TOAD-0563** — Batch-Ausgaben prüfen
- **TOAD-0564** — Oracle Scheduler Jobs verwalten

<a id="g52"></a>

### 52. Sensitive Data Protection: Erkennung und Schutz

Modul: **SDP** · Nachweis: **H** · 11 Punkte.

Quellen: [SDP: Quest: Sensitive Data Protection](https://www.quest.com/news/press-releases/quest-announces-new-toad-for-oracle-sensitive-data-protection-solution-to-help-dbas-meet-strict-data-regulation-standards/).

Hinweis: Separate Lizenz-/Editionsvoraussetzungen; Schutzmechanismen sind Oracle-Funktionen, die Toad unterstützt.

- **TOAD-0565** — Sensible Daten entdecken
- **TOAD-0566** — Vordefinierte Erkennungsregeln
- **TOAD-0567** — Benutzerdefinierte Erkennungsregeln
- **TOAD-0568** — Metadatenbasierte Suche
- **TOAD-0569** — Inhaltsbasierte Suche
- **TOAD-0570** — Erkennungsergebnisse als JSON exportieren
- **TOAD-0571** — Verschlüsselung konfigurieren
- **TOAD-0572** — Redaction konfigurieren
- **TOAD-0573** — Audit-Policies konfigurieren
- **TOAD-0574** — Sensible Spalten im Editor kennzeichnen
- **TOAD-0575** — Sensible Spalten bei Tabellenänderungen kennzeichnen

<a id="g53"></a>

### 53. Sensitive Data Protection: Scan-Optionen

Modul: **SDP** · Nachweis: **H** · 6 Punkte.

Quellen: [SDPS: Quest: Find and protect sensitive data](https://blog.quest.com/product-post/how-to-find-and-protect-sensitive-data-in-your-database).

- **TOAD-0576** — Parallele Scan-Threads
- **TOAD-0577** — Trefferschwellen konfigurieren
- **TOAD-0578** — Bereits geschützte Spalten ausschließen
- **TOAD-0579** — Scan-Berichte erzeugen
- **TOAD-0580** — Scans automatisieren
- **TOAD-0581** — Scan-Berichte zeitgesteuert versenden

<a id="g54"></a>

### 54. Sensitive Data Protection: Standardrichtlinien

Modul: **SDP** · Nachweis: **H** · 4 Punkte.

Quellen: [SDPR: Quest: Rules and default policies](https://blog.toadworld.com/how-to-define-sensitive-data-rules-and-default-policies).

- **TOAD-0582** — Standard-Audit-Policy pro Regel
- **TOAD-0583** — Standard-Verschlüsselung pro Regel
- **TOAD-0584** — Standard-Redaction-Policy pro Regel
- **TOAD-0585** — Regel-Schweregrad festlegen

<a id="g55"></a>

### 55. Team Coding und Versionsverwaltung

Modul: **K/Windows/Repository** · Nachweis: **H** · 13 Punkte.

Quellen: [TEAM: Quest: Team Coding setup](https://support.quest.com/toad-for-oracle/kb/4312734/video-how-to-setup-team-coding-12-10-and-above).

Hinweis: Providerliste historisch; aktuelle Provider-Versionen und Verfügbarkeit separat prüfen.

- **TOAD-0586** — Team Coding
- **TOAD-0587** — Datenbankcode auschecken
- **TOAD-0588** — Datenbankcode einchecken
- **TOAD-0589** — Revisionshistorie
- **TOAD-0590** — Git-Anbindung
- **TOAD-0591** — Subversion-Anbindung
- **TOAD-0592** — TFS-Anbindung
- **TOAD-0593** — CVS-Anbindung
- **TOAD-0594** — ClearCase-Anbindung
- **TOAD-0595** — Visual-SourceSafe-Anbindung
- **TOAD-0596** — VSTS-Anbindung
- **TOAD-0597** — Perforce-Anbindung
- **TOAD-0598** — PVCS-Anbindung

<a id="g56"></a>

### 56. Git-Integration: Detailoptionen

Modul: **K/Windows/Git** · Nachweis: **H** · 7 Punkte.

Quellen: [GIT: Quest: Git integration](https://blog.quest.com/product-post/using-git-version-control-system-in-toad-for-oracle/).

- **TOAD-0599** — Git-Clientpfad konfigurieren
- **TOAD-0600** — Automatische VCS-Anmeldung
- **TOAD-0601** — Git-Benutzername konfigurieren
- **TOAD-0602** — Git-E-Mail konfigurieren
- **TOAD-0603** — Standard-Commit-Kommentar
- **TOAD-0604** — VCS Browser
- **TOAD-0605** — Dateien zur Versionsverwaltung hinzufügen

<a id="g57"></a>

### 57. Git-Integration: Repository-Synchronisation

Modul: **K/Windows/Git** · Nachweis: **H** · 3 Punkte.

Quellen: [GIT2: Quest-Entwickler: Git in Team Coding](https://forums.toadworld.com/t/toad-team-coding-integration-with-git/28661).

- **TOAD-0606** — Repository klonen
- **TOAD-0607** — Git Pull aus Toad
- **TOAD-0608** — Git Push aus Toad

<a id="g58"></a>

### 58. Berichte und Druck

Modul: **K** · Nachweis: **H** · 3 Punkte.

Quellen: [REPORT: Quest: FastReports Q&A](https://blog.quest.com/product-post/toad-for-oracle-fastreports-q-a/).

- **TOAD-0609** — FastReport-Berichtsdesigner
- **TOAD-0610** — Grid-Daten als Berichtsquelle
- **TOAD-0611** — Benutzerdefinierte Berichte

<a id="g59"></a>

### 59. Berichtsvorlagen

Modul: **K** · Nachweis: **H** · 2 Punkte.

Quellen: [PRINT: Quest: Print data using FastReport](https://blog.quest.com/product-post/2018/02/27/print-data-using-fastreport).

- **TOAD-0612** — Datenberichte drucken
- **TOAD-0613** — Berichtsvorlagen bearbeiten

<a id="g60"></a>

### 60. Oberfläche: Menüs und Tastatur

Modul: **K** · Nachweis: **D26** · 6 Punkte.

Quellen: [UI: Quest: Customize Toad](https://support.quest.com/it-it/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/48).

- **TOAD-0614** — Symbolleisten anpassen
- **TOAD-0615** — Menüs anpassen
- **TOAD-0616** — Eigene Untermenüs
- **TOAD-0617** — Befehle per Drag-and-drop umordnen
- **TOAD-0618** — Tastenkürzel zuweisen
- **TOAD-0619** — Menüeinträge umbenennen

<a id="g61"></a>

### 61. Oberfläche: Einstellungen und Layout

Modul: **K** · Nachweis: **D26** · 6 Punkte.

Quellen: [UI2: Quest: Customize toolbars](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/49).

- **TOAD-0620** — Symbolleisten sperren
- **TOAD-0621** — Symbolleisten entsperren
- **TOAD-0622** — Symbolleisten zurücksetzen
- **TOAD-0623** — Neue Befehle hervorheben
- **TOAD-0624** — Ungenutzte Befehle verwalten
- **TOAD-0625** — Einstellungen migrieren

<a id="g62"></a>

### 62. Barrierearme Tastaturbedienung

Modul: **K** · Nachweis: **H** · 4 Punkte.

Quellen: [R25: 2025 R1 – Oracle-23ai-Unterstützung](https://support.quest.com/technical-documents/toad-for-oracle/2025%20r1/release-notes/new-features-and-enhancements).

- **TOAD-0626** — Grid-Kontextmenü über F10
- **TOAD-0627** — Caret-Breite einstellen
- **TOAD-0628** — Editor-/Panel-Fokus per F6 konfigurieren
- **TOAD-0629** — Symbolleisten per Tastatur fokussieren

<a id="g63"></a>

### 63. 2026 R2: KI und kontextbezogene Assistenz

Modul: **AI** · Nachweis: **D26** · 9 Punkte.

Quellen: [N2: Quest-Releaseankündigung 2026 R2 mit Changelog](https://forums.toadworld.com/t/toad-for-oracle-2026-r2-is-now-available/61764).

Hinweis: AI-fähige Lizenz und jeweilige Einrichtung erforderlich; keine autonome Ausführungsfreigabe aus dieser Liste ableiten.

- **TOAD-0630** — Toad Chat
- **TOAD-0631** — SQL erklären lassen
- **TOAD-0632** — SQL Validate
- **TOAD-0633** — SQL per Chat optimieren
- **TOAD-0634** — Eingebetteter MCP-Server
- **TOAD-0635** — Aktive Verbindung als KI-Kontext
- **TOAD-0636** — Copilot Next Edit Suggestions
- **TOAD-0637** — Mehrzeilige Codevorschläge
- **TOAD-0638** — Folgeänderungen vorschlagen

<a id="g64"></a>

### 64. 2026 R2: kleine Bedienfunktionen

Modul: **K/teilweise DBA** · Nachweis: **D26** · 18 Punkte.

Quellen: [N2: Quest-Releaseankündigung 2026 R2 mit Changelog](https://forums.toadworld.com/t/toad-for-oracle-2026-r2-is-now-available/61764).

- **TOAD-0639** — Grid-Such-/Filterpanel
- **TOAD-0640** — Verbindungen mit Shift ohne Speicherabfragen schließen
- **TOAD-0641** — Credential-Objekte für DB Links
- **TOAD-0642** — Debugger-Hover-Hinweise abschalten
- **TOAD-0643** — Debugger-Hover-Verzögerung einstellen
- **TOAD-0644** — Oracle-Plan-Tabelle bevorzugen
- **TOAD-0645** — LogMiner: Oracle-Verzeichnisse durchsuchen
- **TOAD-0646** — LogMiner: Redo-Dateinamen einfügen
- **TOAD-0647** — Hauptmenü-Schrift einstellen
- **TOAD-0648** — Objektnamen inkrementell filtern
- **TOAD-0649** — Teiltreffer hervorheben
- **TOAD-0650** — PASSWORD_CHANGE_DATE anzeigen
- **TOAD-0651** — Profil: Resource Type anzeigen
- **TOAD-0652** — Regex-/Wildcard-Quickfilter merken
- **TOAD-0653** — Session-Baum-Expansion merken
- **TOAD-0654** — TNS-Syntax prüfen
- **TOAD-0655** — Doppelte TNS-Einträge erkennen
- **TOAD-0656** — Datenbank im Fenstertitel anzeigen

<a id="g65"></a>

### 65. 2026 R1: zusätzliche Detailfunktionen

Modul: **K/teilweise DBA** · Nachweis: **D26** · 32 Punkte.

Quellen: [R1: Toad for Oracle 2026 R1 – Release Notes](https://support-public.cfm.quest.com/82280_ToadForOracle_2026_R1_ReleaseNotes.pdf).

Hinweis: Ergänzungen aus R1; kein Anspruch, jede Release-Note oder Fehlerbehebung als separates Feature abzubilden.

- **TOAD-0657** — Eigene Sessions grün markieren
- **TOAD-0658** — Blockierte Sessions rot markieren
- **TOAD-0659** — Blockierende Sessions hervorheben
- **TOAD-0660** — Sperrdetails per Hover
- **TOAD-0661** — Blocking-/Blocked-Unteransichten
- **TOAD-0662** — Sessions nach Spalten gruppieren
- **TOAD-0663** — Session-Gruppierung speichern
- **TOAD-0664** — Session-Layoutprofile
- **TOAD-0665** — Session-Gruppen vollständig aufklappen
- **TOAD-0666** — Session-Gruppen vollständig zuklappen
- **TOAD-0667** — Verbindungen gruppenweise schließen
- **TOAD-0668** — Workspace-Import
- **TOAD-0669** — Workspace-Export
- **TOAD-0670** — ANYDATA-Popup-Editor
- **TOAD-0671** — Gruppierte Grid-Spalten ausblenden
- **TOAD-0672** — Grid-Layouts speichern
- **TOAD-0673** — Mehrzeilige INSERT-Ausgabe für Oracle 23c
- **TOAD-0674** — Git-Historienlänge begrenzen
- **TOAD-0675** — Dateiänderungen außerhalb Toad kennzeichnen
- **TOAD-0676** — Zuletzt aktives Fenster wiederherstellen
- **TOAD-0677** — Benutzer sperren und Passwort ablaufen lassen
- **TOAD-0678** — DML in Schleifen erkennen
- **TOAD-0679** — COMMIT in Schleifen erkennen
- **TOAD-0680** — TNS-Einträge sortieren
- **TOAD-0681** — TNS-Einträge filtern
- **TOAD-0682** — Cursor-Ausgabe als eingebettetes Grid
- **TOAD-0683** — Tablespace-I/O-Unteransicht
- **TOAD-0684** — Auswahlzeilenzahl anzeigen
- **TOAD-0685** — SQL-Developer-Verbindungen aus JSON importieren
- **TOAD-0686** — Proxy-Benutzer anzeigen
- **TOAD-0687** — Verbindungssicherheit anzeigen
- **TOAD-0688** — Schema-Favoriten per Drag-and-drop ordnen

<a id="g66"></a>

### 66. Zusatzprodukt SQL Optimizer: Optimierung

Modul: **SQL Optimizer** · Nachweis: **H** · 12 Punkte.

Quellen: [OPT: SQL Optimizer 10.1: User Guide](https://support.quest.com/technical-documents/sql-optimizer-for-oracle/10.1/user-guide/welcome-to-sql-optimizer).

Hinweis: Eigenständiges Zusatzprodukt; genaue ausgelieferte Version separat feststellen.

- **TOAD-0689** — SQL automatisch umschreiben
- **TOAD-0690** — Semantisch äquivalente SQL-Alternativen erzeugen
- **TOAD-0691** — Optimizer-Hints variieren
- **TOAD-0692** — Manuelle SQL-Alternativen vergleichen
- **TOAD-0693** — Alternativen durch Ausführung testen
- **TOAD-0694** — Ausführungsstatistiken vergleichen
- **TOAD-0695** — Indexempfehlungen erzeugen
- **TOAD-0696** — Virtuelle Indizes untersuchen
- **TOAD-0697** — Indexempfehlungen für Workloads
- **TOAD-0698** — Ausführungspläne kontrollieren
- **TOAD-0699** — SQL Plan Baselines nutzen
- **TOAD-0700** — Skalierung mit Benchmark Factory untersuchen

<a id="g67"></a>

### 67. Zusatzprodukt SQL Optimizer: Analysewerkzeuge

Modul: **SQL Optimizer** · Nachweis: **H** · 16 Punkte.

Quellen: [OPT2: SQL Optimizer 9.3.3: User Guide](https://support.quest.com/technical-documents/sql-optimizer-for-oracle/9.3.3/user-guide/).

Hinweis: Historischer Detailkatalog; keine Behauptung über unveränderte 2026-Menüs.

- **TOAD-0701** — SQL im SGA untersuchen
- **TOAD-0702** — SQL in Quellbeständen scannen
- **TOAD-0703** — SQL im Batch optimieren
- **TOAD-0704** — Änderungsauswirkungen analysieren
- **TOAD-0705** — Stored Outlines verwalten
- **TOAD-0706** — SQL Translation nutzen
- **TOAD-0707** — Bind-Werte für Tests definieren
- **TOAD-0708** — Test-Ausführungseinstellungen speichern
- **TOAD-0709** — Ausführungsmethode auswählen
- **TOAD-0710** — Optimierung pausieren
- **TOAD-0711** — Optimierung fortsetzen
- **TOAD-0712** — Ausführungspläne vergleichen
- **TOAD-0713** — Optimierungsberichte
- **TOAD-0714** — Tabellenattribute untersuchen
- **TOAD-0715** — Indexattribute untersuchen
- **TOAD-0716** — Spaltenattribute untersuchen

<a id="g68"></a>

### 68. Zusatzprodukt Code Tester: Testverwaltung

Modul: **Code Tester** · Nachweis: **H** · 6 Punkte.

Quellen: [CT: Quest: Code Tester 4.0](https://support.quest.com/code-tester-for-oracle/kb/4370982/what-s-new-in-code-tester-for-oracle-4-0-).

Hinweis: Die Toad-Integration bildet nur einen Teil des eigenständigen Code Tester ab.

- **TOAD-0717** — PL/SQL-Tests automatisieren
- **TOAD-0718** — Testausführung per Kommandozeile
- **TOAD-0719** — CI-Berichte erzeugen
- **TOAD-0720** — Repository-Administration über Rollen
- **TOAD-0721** — Lokale Test-Repositories
- **TOAD-0722** — Gemeinsame Test-Repositories

<a id="g69"></a>

### 69. Zusatzprodukt Code Tester: Testpflege

Modul: **Code Tester** · Nachweis: **H** · 6 Punkte.

Quellen: [CT2: Quest: Code Tester community and features](https://blog.quest.com/product-post/2018/02/19/new-dedicated-code-tester-for-oracle-community).

- **TOAD-0723** — Testläufe debuggen
- **TOAD-0724** — Frontend-Tracing
- **TOAD-0725** — Testfelder deaktivieren
- **TOAD-0726** — Proxy-Benutzer verwenden
- **TOAD-0727** — Edition-Based Redefinition unterstützen
- **TOAD-0728** — Tests mit Code Evolution an Codeänderungen anpassen

<a id="g70"></a>

### 70. Zusatzprodukt Benchmark Factory

Modul: **Benchmark Factory** · Nachweis: **H** · 20 Punkte.

Quellen: [BF: Benchmark Factory 9.1: User Guide](https://support.quest.com/technical-documents/doc2311004).

Hinweis: Bundle-Limits für virtuelle Benutzer beachten; keine unbegrenzte Lizenz aus der Produktfähigkeit ableiten.

- **TOAD-0729** — Datenbanklast simulieren
- **TOAD-0730** — Virtuelle Benutzer
- **TOAD-0731** — Verteilte Lastagenten
- **TOAD-0732** — Windows-Agenten
- **TOAD-0733** — Linux-Agenten
- **TOAD-0734** — Workloads aufzeichnen
- **TOAD-0735** — Workloads wiedergeben
- **TOAD-0736** — Vorhandene Captures wiederverwenden
- **TOAD-0737** — Oracle-Workload-Capture
- **TOAD-0738** — Trace-Dateien als Workloadquelle
- **TOAD-0739** — Repository als Workloadquelle
- **TOAD-0740** — Textdateien als Workloadquelle
- **TOAD-0741** — Lasttest-Jobs verwalten
- **TOAD-0742** — Testläufe zeitlich planen
- **TOAD-0743** — Benchmark-Ergebnisberichte
- **TOAD-0744** — Repository Manager
- **TOAD-0745** — Capture bei CPU-Grenzwert stoppen
- **TOAD-0746** — Capture bei Speichermangel stoppen
- **TOAD-0747** — Capture sofort starten
- **TOAD-0748** — Capture zeitgesteuert starten

<a id="g71"></a>

### 71. Zusatzprodukt Spotlight on Oracle

Modul: **Spotlight** · Nachweis: **H** · 13 Punkte.

Quellen: [SPOT: Spotlight on Oracle: Datasheet](https://www.quest.com/documents/spotlight-on-oracle-datasheet-72044.pdf).

- **TOAD-0749** — Echtzeit-Diagnose-Dashboard
- **TOAD-0750** — Oracle-Prozesse grafisch darstellen
- **TOAD-0751** — Performance-Engpässe lokalisieren
- **TOAD-0752** — Benutzerbezogene Diagnose
- **TOAD-0753** — SQL-bezogene Diagnose
- **TOAD-0754** — I/O-Engpässe diagnostizieren
- **TOAD-0755** — Lock-Waits diagnostizieren
- **TOAD-0756** — Baselines automatisch bestimmen
- **TOAD-0757** — Alarmschwellen automatisch bestimmen
- **TOAD-0758** — Performance-Alarme anzeigen
- **TOAD-0759** — Linux-Betriebssystemdiagnose
- **TOAD-0760** — UNIX-Betriebssystemdiagnose
- **TOAD-0761** — Windows-Betriebssystemdiagnose

<a id="g72"></a>

### 72. Zusatzprodukt Spotlight: Editionsoptionen

Modul: **Spotlight/Edition** · Nachweis: **D26** · 3 Punkte.

Quellen: [R2: Toad for Oracle 2026 R2 – Release Notes](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/release-notes).

Hinweis: Nicht Bestandteil jeder Spotlight-/Toad-Edition.

- **TOAD-0762** — Data-Guard-Diagnosekomponente
- **TOAD-0763** — RAC-Diagnosekomponente
- **TOAD-0764** — Exadata-Diagnosekomponente

<a id="g73"></a>

### 73. Zusatzprodukt Toad Data Modeler

Modul: **Toad Data Modeler** · Nachweis: **H** · 39 Punkte.

Quellen: [TDM: Toad Data Modeler 7.3: Introduction](https://support.quest.com/technical-documents/toad-data-modeler/7.3/user-guide/introduction).

Hinweis: Eigenständiger Modeler; diese Funktionsauswahl ist kein vollständiger Audit aller Modeler-Dialoge. Nicht auf erwin Lite übertragbar.

- **TOAD-0765** — Logische Datenmodelle
- **TOAD-0766** — Physische Datenmodelle
- **TOAD-0767** — Universelle Datenmodelle
- **TOAD-0768** — ER-Diagramme visuell bearbeiten
- **TOAD-0769** — Mehrere Ziel-Datenbanksysteme
- **TOAD-0770** — Reverse Engineering aus Datenbanken
- **TOAD-0771** — DDL generieren
- **TOAD-0772** — Modelle validieren
- **TOAD-0773** — Modellfehler anzeigen
- **TOAD-0774** — Modellwarnungen anzeigen
- **TOAD-0775** — Modellhinweise anzeigen
- **TOAD-0776** — Quick Fixes
- **TOAD-0777** — HTML-Dokumentation
- **TOAD-0778** — RTF-Dokumentation
- **TOAD-0779** — PDF-Dokumentation
- **TOAD-0780** — Modellmetadaten nach Excel exportieren
- **TOAD-0781** — Modellattribute aus Excel importieren
- **TOAD-0782** — Änderungsskripte generieren
- **TOAD-0783** — Modell aus Datenbank aktualisieren
- **TOAD-0784** — Modelle vergleichen
- **TOAD-0785** — Modelle zusammenführen
- **TOAD-0786** — Interne Modellversionen
- **TOAD-0787** — Git für Modellversionen
- **TOAD-0788** — Subversion für Modellversionen
- **TOAD-0789** — Modellprojekte
- **TOAD-0790** — Automatisches Diagrammlayout
- **TOAD-0791** — Refactoring-Werkzeug
- **TOAD-0792** — Modellautomatisierung
- **TOAD-0793** — Scripting
- **TOAD-0794** — Modellvorlagen
- **TOAD-0795** — Objektgalerie
- **TOAD-0796** — Standardwerte
- **TOAD-0797** — Anwendungsvariablen
- **TOAD-0798** — Makros
- **TOAD-0799** — Undo und Redo
- **TOAD-0800** — Aufgabenliste
- **TOAD-0801** — Diagramm-Zoom
- **TOAD-0802** — Diagramm-Lupe
- **TOAD-0803** — Modellübersicht

<a id="g74"></a>

### 74. Verbindungsdialog: zusätzliche Detailoptionen

Modul: **K** · Nachweis: **D26** · 16 Punkte.

Quellen: [CONDETAIL: Toad for Oracle 2026 R1 – Verbindungsdetails und Inhaltsverzeichnis](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/4).

- **TOAD-0804** — Direktverbindung über Host und Port
- **TOAD-0805** — Service Name als Verbindungsziel
- **TOAD-0806** — SID als Verbindungsziel
- **TOAD-0807** — TNS-Aliase auswählen
- **TOAD-0808** — LDAP-Deskriptor auswählen
- **TOAD-0809** — IFILE-Verweise in TNS-Dateien auflösen
- **TOAD-0810** — Verschachtelte TNS-Dateien bis drei Ebenen
- **TOAD-0811** — IFILE-Verweis in anderem Editor öffnen
- **TOAD-0812** — Fehlende Oracle-Konfigurationsdateien kennzeichnen
- **TOAD-0813** — Verbindungsprivileg über Connect as auswählen
- **TOAD-0814** — Verbindungsalias statt Datenbankname anzeigen
- **TOAD-0815** — Automation-Aktion beim manuellen Verbindungsaufbau auslösen
- **TOAD-0816** — Parameterdatei für Verbindungsaktion auswählen
- **TOAD-0817** — Verbindung als Read Only markieren
- **TOAD-0818** — Profil speichern, ohne Verbindung aufzubauen
- **TOAD-0819** — Profilfelder für weitere Verbindung wiederverwenden

<a id="g75"></a>

### 75. Explain Plan und integrierte Hilfe

Modul: **K** · Nachweis: **D26** · 7 Punkte.

Quellen: [CONDETAIL: Toad for Oracle 2026 R1 – Verbindungsdetails und Inhaltsverzeichnis](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/4).

Hinweis: Diese Funktionen sind im Inhaltsverzeichnis des Handbuchs nachgewiesen; deren Unteroptionen sind hier nicht vollständig erfasst.

- **TOAD-0820** — Explain Plan erzeugen
- **TOAD-0821** — Explain Plan speichern
- **TOAD-0822** — Jump Search für Funktionen und Hilfe
- **TOAD-0823** — Toad Advisor
- **TOAD-0824** — Support-Bundle erstellen
- **TOAD-0825** — Eigene Workspaces erstellen
- **TOAD-0826** — Tastenkürzelliste drucken

## Offene Prüfbereiche für einen lückenlosen Installationsaudit

Die folgenden Bereiche sind nicht vollständig bis auf jedes Dialogfeld dokumentiert. Sie werden nicht als erledigt ausgegeben:

- Sämtliche Einstellungen unter Tools / Options, alle Kontextmenüs, Symbolleistenbefehle und Tastenkombinationen.
- Jede einzelne Code-Analysis-Regel, Formatter-Regel, Testdaten-Generatorvariante und Health-Check-Regel.
- Alle Objektunterdialoge: Datentypen, Storage-Klauseln, Partitionierungsvarianten, Privilegien und Oracle-spezifische Attribute.
- Sämtliche Automation-Aktionen einschließlich aller Parameter, Fehlerpfade und Dateiformate.
- Vollständiger Funktionsumfang jedes eigenständigen Suite-Produkts sowie genaue Einschränkungen von erwin Lite.
- Gegenprüfung der historisch belegten Funktionen in der installierten R2-Version und exakte Mindestlizenz je Eintrag.
- Vollständiger Vergleich der Windows- und Mac-Ausgaben.

Für einen belastbaren Abschluss wären die konkrete Installation mit Versionsnummer und Lizenzmodulen, deren kontextsensitive Hilfe sowie eine systematische Aufnahme aller Menüs und Dialoge erforderlich. Für jeden Eintrag wären dann Sichtbarkeit, Ausführbarkeit, Voraussetzungen und Plattform zu protokollieren. Erst danach lässt sich die Vollständigkeit gegenüber genau dieser Installation beurteilen.

## Quellenverzeichnis

Alle folgenden Quellen stammen aus Quest-Dokumentation, Quest-Support, Quest-Blogs oder Toad World. Historische Quellen sind absichtlich enthalten und über den Nachweisstatus von aktuellen Dokumentationsbelegen getrennt. Forenbeiträge besitzen eine geringere Nachweisstärke als ein versionsbezogenes Handbuch; Verfügbarkeit ist gegebenenfalls nachzuprüfen.

- **R2** — [Toad for Oracle 2026 R2 – Release Notes](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/release-notes)
- **N2** — [Quest-Releaseankündigung 2026 R2 mit Changelog](https://forums.toadworld.com/t/toad-for-oracle-2026-r2-is-now-available/61764)
- **R1** — [Toad for Oracle 2026 R1 – Release Notes](https://support-public.cfm.quest.com/82280_ToadForOracle_2026_R1_ReleaseNotes.pdf)
- **G** — [Getting Started 2026 R1, PDF](https://support-public.cfm.quest.com/82278_ToadForOracle_2026_R1_UserGuide.pdf)
- **M** — [Subscription Functional Matrix 2025 R3](https://www.quest.com/documents/quest-toad-for-oracle-subscription-editions-functional-matrix-datasheet-173484.pdf)
- **M2** — [Quest Subscription-Vergleichsmatrix, Dokumentstand 2022](https://blog.quest.com/wp-content/uploads/2025/09/comparison-matrix-toad-for-oracle-subscription-products-datasheet-148328.pdf)
- **H** — [Quest: Wo liegt die vollständige Benutzerhilfe?](https://support.quest.com/toad-for-oracle/kb/4270821/where-can-i-find-the-toad-for-oracle-user-guide-or-manual)
- **D** — [DB Admin Module – Datenblatt](https://www.quest.com/documents/toad-for-oracle-db-admin-module-datasheet-146117.pdf)
- **E** — [DBA Evaluation Guide 2021 R1](https://www.quest.com/documents/toad-for-oracle-trial-evaluation-matrix-dba-datasheet-149193.pdf)
- **R25** — [2025 R1 – Oracle-23ai-Unterstützung](https://support.quest.com/technical-documents/toad-for-oracle/2025%20r1/release-notes/new-features-and-enhancements)
- **R17** — [17.0 – Release Notes](https://support.quest.com/technical-documents/toad-for-oracle/17.0/release-notes)
- **N15** — [Quest: Release 15.1.113.1379](https://forums.toadworld.com/t/toad-for-oracle-15-1-113-1379-now-available/54516)
- **N17** — [Quest: Release 17.0.341.1977](https://forums.toadworld.com/t/toad-for-oracle-toad-for-oracle-on-mac-17-0-341-1977-is-now-available/58422)
- **CON** — [Getting Started 2026 R1 – Verbindungen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/5)
- **CON17** — [Quest: Verbindungen in Release 17.0](https://forums.toadworld.com/t/toad-for-oracle-toad-for-oracle-on-mac-17-0-341-1977-is-now-available/58422)
- **AUTH** — [Subscription Functional Matrix 2025 R3](https://www.quest.com/documents/quest-toad-for-oracle-subscription-editions-functional-matrix-datasheet-173484.pdf)
- **CEXP** — [Quest: Verbindungen samt verschlüsselten Passwörtern übertragen](https://support.quest.com/toad-for-oracle/2026%20r1)
- **CORG** — [Getting Started 2026 R1 – Anpassung von Verbindungen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/45)
- **ED** — [Getting Started 2026 R1 – Editor Basics](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/7)
- **FIND** — [Getting Started 2026 R1 – Find and Replace](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/8)
- **TPL** — [Getting Started 2026 R1 – Code Completion Templates](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/write-statements-and-scripts/use-the-object-palette)
- **SNP** — [Getting Started 2026 R1 – Snippets und Code Insight](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/25)
- **WRITE** — [Getting Started 2026 R2 – dokumentierte Editorfunktionen](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/34)
- **RUN** — [Getting Started 2026 R1 – Skriptausführung](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/30)
- **PL** — [Getting Started 2026 R1 – PL/SQL-Objekte und SQL Recall](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/work-with-plsql-objects/reload-object)
- **QB** — [Getting Started 2026 R1 – grafischer Query Builder](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/29)
- **DBG** — [Getting Started 2026 R1 – Debugger starten und parametrisieren](https://support.quest.com/fr-fr/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/35)
- **WATCH** — [Getting Started 2026 R1 – Watches](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/41)
- **BREAK** — [Getting Started 2026 R1 – Breakpoints und Debug-Kapitel](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/40)
- **PROF** — [Getting Started 2026 R1 – Profiler](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/43)
- **DIFF** — [Getting Started 2026 R1 – Compare Files](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/work-with-code/write-statements-and-scripts/save-query-results)
- **SB** — [Getting Started 2026 R1 – Schema Browser](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/10)
- **SBF** — [Getting Started 2026 R1 – Schema-Filter](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/11)
- **OBJ** — [Getting Started 2026 R1 – Object Search](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/18)
- **DDL** — [Getting Started 2026 R1 – Create/Alter Objects](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/19)
- **FK** — [Getting Started 2026 R1 – Foreign Key Lookup](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/20)
- **GRID** — [Getting Started 2026 R1 – Data Grid Basics](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/data-grid-basics)
- **EDITDATA** — [Getting Started 2026 R1 – Daten bearbeiten](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/17)
- **COPY** — [Getting Started 2026 R1 – Copy Data](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/15)
- **DC** — [Getting Started 2026 R1 – Compare Data](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/16)
- **DCK** — [Getting Started 2025 R1 – Vergleichsdetails](https://support.quest.com/technical-documents/toad-for-oracle/2025%20r1/getting-started-guide/work-with-data/compare-data)
- **SC** — [Getting Started 2026 R1 – Object/Schema Compare](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/21)
- **REBUILD** — [Getting Started 2026 R1 – Datenbankvergleich und Rebuild](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/22)
- **EXP** — [Quest: Exportmöglichkeiten von Toad for Oracle](https://blog.quest.com/product-post/so-you-want-to-export-data-from-oracle-let-s-count-the-ways/)
- **XLS** — [Quest KB: Export in Excel-Datei oder laufende Instanz](https://support.quest.com/toad-for-oracle/kb/4217693/como-exportar-datos-desde-toad-a-excel)
- **XLS2** — [Quest KB: XLSX-Export](https://support.quest.com/toad-for-oracle/kb/4317319/how-to-save-the-export-data-grid-results-of-a-select-statement-or-query-into-an-excel-2007-file)
- **XLS3** — [Quest KB: Spaltenüberschriften beim Excel-Export](https://support.quest.com/toad-for-oracle/kb/4308429/when-i-export-my-query-data-results-to-excel-file-i-am-unable-to-include-column-name-headers)
- **XLS4** — [Quest KB: Excel Sheet Name](https://support.quest.com/kb/4290479/export-dataset-to-an-excel-file-how-to-change-or-give-a-custom-name-to-the-sheet-name-where-the-data-goes-into-)
- **IMP** — [Quest KB: Import Table Data](https://support.quest.com/toad-for-oracle/kb/4335213/import-excel-file-into-oracle-using-toad)
- **LOAD** — [Quest: Toad for Oracle General Q&A](https://blog.toadworld.com/toad-for-oracle-general-qa)
- **QUAL** — [Quest: Code Review und Qualitätsmetriken](https://blog.quest.com/product-post/toad-code-review-useful-to-the-programmer/)
- **GEN** — [Quest: Developer Evaluation Guide 2021 R1](https://www.quest.com/documents/toad-for-oracle-trial-evaluation-matrix-developer-datasheet-149194.pdf)
- **UT** — [Getting Started 2026 R1 – Create Unit Tests](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r1/getting-started-guide/create-unit-tests)
- **DBB** — [Quest: Database Browser](https://blog.quest.com/product-post/how-to-monitor-database-activity-with-the-toad-database-browser-utility/)
- **AUTO** — [Quest: Automation Designer](https://blog.quest.com/product-post/using-automation-designer-for-everyday-tasks)
- **ITER** — [Quest-Entwickler: Automation Designer](https://forums.toadworld.com/t/execute-script-in-multiple-databases-automation-designer/61324)
- **QITER** — [Quest-Forum: Query Iterator](https://forums.toadworld.com/t/automation-designer-query-iterator-using-variable/40709)
- **CLI** — [Quest: Command-line automation](https://blog.quest.com/product-post/how-do-i-use-the-command-line-options-to-make-toad-do-something-every-night/)
- **SCRIPTS** — [Quest: Batch Jobs](https://blog.quest.com/product-post/how-to-schedule-batch-jobs-in-toad-for-oracle-pro-db-admin/)
- **SDP** — [Quest: Sensitive Data Protection](https://www.quest.com/news/press-releases/quest-announces-new-toad-for-oracle-sensitive-data-protection-solution-to-help-dbas-meet-strict-data-regulation-standards/)
- **SDPS** — [Quest: Find and protect sensitive data](https://blog.quest.com/product-post/how-to-find-and-protect-sensitive-data-in-your-database)
- **SDPR** — [Quest: Rules and default policies](https://blog.toadworld.com/how-to-define-sensitive-data-rules-and-default-policies)
- **TEAM** — [Quest: Team Coding setup](https://support.quest.com/toad-for-oracle/kb/4312734/video-how-to-setup-team-coding-12-10-and-above)
- **GIT** — [Quest: Git integration](https://blog.quest.com/product-post/using-git-version-control-system-in-toad-for-oracle/)
- **GIT2** — [Quest-Entwickler: Git in Team Coding](https://forums.toadworld.com/t/toad-team-coding-integration-with-git/28661)
- **REPORT** — [Quest: FastReports Q&A](https://blog.quest.com/product-post/toad-for-oracle-fastreports-q-a/)
- **PRINT** — [Quest: Print data using FastReport](https://blog.quest.com/product-post/2018/02/27/print-data-using-fastreport)
- **UI** — [Quest: Customize Toad](https://support.quest.com/it-it/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/48)
- **UI2** — [Quest: Customize toolbars](https://support.quest.com/technical-documents/toad-for-oracle/2026%20r2/getting-started-guide/49)
- **OPT** — [SQL Optimizer 10.1: User Guide](https://support.quest.com/technical-documents/sql-optimizer-for-oracle/10.1/user-guide/welcome-to-sql-optimizer)
- **OPT2** — [SQL Optimizer 9.3.3: User Guide](https://support.quest.com/technical-documents/sql-optimizer-for-oracle/9.3.3/user-guide/)
- **CT** — [Quest: Code Tester 4.0](https://support.quest.com/code-tester-for-oracle/kb/4370982/what-s-new-in-code-tester-for-oracle-4-0-)
- **CT2** — [Quest: Code Tester community and features](https://blog.quest.com/product-post/2018/02/19/new-dedicated-code-tester-for-oracle-community)
- **BF** — [Benchmark Factory 9.1: User Guide](https://support.quest.com/technical-documents/doc2311004)
- **SPOT** — [Spotlight on Oracle: Datasheet](https://www.quest.com/documents/spotlight-on-oracle-datasheet-72044.pdf)
- **TDM** — [Toad Data Modeler 7.3: Introduction](https://support.quest.com/technical-documents/toad-data-modeler/7.3/user-guide/introduction)
- **CONDETAIL** — [Toad for Oracle 2026 R1 – Verbindungsdetails und Inhaltsverzeichnis](https://support.quest.com/de-de/technical-documents/toad-for-oracle/2026-r1/getting-started-guide/4)
