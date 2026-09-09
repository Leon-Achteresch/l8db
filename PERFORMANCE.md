# Performance-Audit, 7. September 2026

Die größten gemessenen Engpässe lagen im Rendering breiter Tabellen, im Laden der Arbeitsoberfläche und in der lokalen Textsortierung. Der ursprüngliche Stand `572ce43` wurde in einem separaten Checkout mit demselben erweiterten Browser-Fixture verglichen.

## Gemessene Ergebnisse

Headless Chromium, Produktionsbuild, vollständige App-Styles und Fonts, 1.200 × 600 Pixel, 5.000 Zeilen, 1,5 Sekunden automatisches vertikales Scrollen. Die breite Tabelle enthält 120 erzeugte Datenspalten plus `id` und die Zeilennummer. Werte sind einzelne lokale Messläufe, keine statistischen Garantien.

| Breite Datentabelle | Vorher | Nachher |
|---|---:|---:|
| Bildrate | 11,4 FPS | 60,4 FPS |
| Schlechtester Frame | 99,6 ms | 18,4 ms |
| Mount-Zeit | 267 ms | 104 ms |
| Gerenderte Zellen beim Mount | 3.295 | 244 |
| JS-Heap nach dem Scrollen | 227,9 MB | 82,4 MB |

Die Zeilenvirtualisierung war bereits vorhanden. Erst die zusätzliche Spaltenvirtualisierung begrenzt die Zahl der tatsächlich gerenderten Zellen unabhängig von der Gesamtbreite. Im Vergleich sind das rund 5,3-mal so viele Frames pro Sekunde, 93 % weniger gerenderte Zellen und 64 % weniger gemessener JS-Heap.

Headless WebKit wurde separat mit denselben Styles und Interaktionstests geprüft. Die breite Datentabelle verbessert sich dort von 7,1 auf 49,0 FPS; die Mount-Zeit sinkt von 635 auf 131 ms. WebKit stellt in diesem Test keinen vergleichbaren JS-Heap-Wert bereit. Diese Messung ist näher am macOS-Renderingpfad, ersetzt aber kein Profiling des vollständigen Tauri-Prozesses.

Die breite SQL-Ergebnistabelle war in Chromium bereits flüssig: 59,5 gegenüber 60,6 FPS. Ihre gerenderten Zellen sinken von 4.027 auf 298, der gemessene Heap von 87,5 auf 61,0 MB. Schmale Tabellen zeigen keinen gesicherten allgemeinen FPS-Gewinn; dort begrenzen bereits Displayfrequenz und Messschwankungen den Vergleich.

Weitere Messungen:

| Arbeit | Vorher | Nachher |
|---|---:|---:|
| Textsortierung, 20.000 Zeilen, drei Läufe unter Bun | 716–762 ms | 18–24 ms |
| Statische JS-Abhängigkeiten von Entry, App- und Workspace-Layout | 6,019 MB | 1,639 MB |
| Zugehörige JS-Chunks | 116 | 77 |
| Serialisierungen bei 100 unmittelbar aufeinanderfolgenden Tab-Updates | 100 im bisherigen Persist-Pfad | 1 nach Flush |

Die Bundle-Angaben sind unkomprimierte Dateigrößen des transitiven statischen Importgraphen. Die aktive Fachansicht kann weitere Chunks laden. Es handelt sich weder um eine gemessene Startdauer noch um den Speicherbedarf der gesamten Anwendung. Heap-Samples enthalten temporäre Allokationen und hängen vom Garbage Collector ab.

## Ursachen und Änderungen

### Tabellen und Rendering

- `use-column-window.ts` virtualisiert bei mehr als 20 sichtbaren Spalten auch horizontal. Fixierte Spalten bleiben im Renderfenster. Platzhalter mit passenden Spaltenbreiten erhalten Tabellenlayout und Scrollbreite.
- `data-table-row.tsx` kapselt eine memoized Zeile. Beim Scrollen müssen weiter sichtbare Zeilen nicht vollständig neu rendern. Änderungen an Daten, Spaltenreihenfolge, Breiten, Fixierungen, Suche, Auswahl und Bearbeitung bleiben berücksichtigt.
- Die Spaltenreihenfolge für Rendering und Tastaturnavigation folgt der tatsächlichen Reihenfolge aus linken, mittleren und rechten Spalten. Tastaturnavigation und Suchtreffer scrollen auch horizontal zur Zielspalte.
- `data-table-header-cell.tsx` und der Index-Header verwenden deckende Hintergründe ohne wiederholte Hintergrund-Unschärfe. Die Zellen animieren Farbwechsel nicht mehr während des Scrollens. Der Test mit vollständigen Styles deckte diesen zusätzlichen Paint-Aufwand auf.
- `QueryResultTable` ist memoized und nutzt dasselbe horizontale Renderfenster. Filtereingaben verwenden `useDeferredValue`, damit die Eingabe nicht auf die Aktualisierung des Ergebnisses warten muss.

### SQL-Editor, Sortierung und Speicherung

- `QueryView` hält das Schema-Registry-Objekt per `useMemo` stabil. Zuvor löste ein neues Objekt bei jedem Render, etwa einer Cursorbewegung, erneut `refreshLintMarkers` aus und umging damit praktisch das Debouncing der Inhaltsprüfung.
- SQL-Completion-Provider prüfen das zugehörige Monaco-Modell. Bei mehreren Editoren erzeugt nicht mehr jeder registrierte Provider Vorschläge für fremde Modelle.
- `result-grid.ts` verwendet einen wiederverwendeten deutschen `Intl.Collator`. Der bisherige Pfad initialisierte die sprachabhängige Vergleichslogik über `localeCompare` mit Optionen für jeden Sortiervergleich erneut. Typen werden nur für tatsächlich sortierte Spalten bestimmt; NULL-Reihenfolge und stabile Sortierung bleiben erhalten.
- `buffered-storage.ts` bündelt Tab-Snapshots vor `JSON.stringify` und `localStorage.setItem`. Ein Timer schreibt spätestens nach dem konfigurierten Intervall von 250 ms, ohne durch weitere Tastenanschläge ständig verschoben zu werden. `pagehide`, `beforeunload` und der Wechsel in einen unsichtbaren Dokumentzustand lösen ebenfalls einen Flush aus. Hydrierung liest bei ausstehenden Änderungen den neuesten Snapshot, und Entfernen verwirft ausstehende Schreibvorgänge.
- Ein Prozessabbruch kann weiterhin die letzten noch nicht geschriebenen Änderungen verlieren, im Normalfall bis zu 250 ms. Bei blockiertem Main Thread kann sich der Timer verzögern.

### Start, Navigation und Datenabfragen

- Split-Pane-Ansichten, Tabellensuche, SQL-Filtereditor, View-Definition und Tabellen-Performancebericht werden bei Bedarf importiert. Monaco wird nicht mehr allein durch das Workspace-Layout geladen. Die Tabellensuche bleibt nach dem ersten Öffnen gemountet, damit ihre Eingaben erhalten bleiben.
- Der Extension-Host startet nach Freigabe des App-Renderings und blockiert die Arbeitsoberfläche nicht mehr bis zur vollständigen Extension-Aktivierung. Verbindungsgeheimnisse, Provider und SSH-Wiederherstellung bleiben vor dem Rendering initialisiert.
- `createAppQueryClient` gibt Metadaten standardmäßig 60 Sekunden Frische. Vorhandene speziellere Frischezeiten bleiben wirksam. Zeilen, Sessions und Locks erhalten diese Frischezeit nicht.
- Unbenutzte Zeilen-Caches werden nach 60 Sekunden, Such-Caches nach 30 Sekunden freigegeben. Aktive Queries bleiben erhalten.
- Die globale Objektsuche lädt ihre Daten beim Öffnen. Eine leere Favoritenliste lädt keine vollständige Objektliste mehr.
- Verbindungs-Refresh berücksichtigt zusätzlich detaillierte Spalten und Suchdaten. Eine Zeilenänderung aktualisiert nur Caches der betroffenen Verbindung, Datenbank und Tabelle. Diese Identität wird beim Mutationsstart erfasst, damit ein Verbindungswechsel während des Speicherns keine fremden Caches verändert.
- Placeholder-Daten werden nicht mehr zwischen gleichnamigen Tabellen unterschiedlicher Verbindungen, Datenbanken oder Entity-Typen übernommen.
- Export-Zeilen werden erst für den Export bzw. einen geöffneten Exportdialog kopiert, statt nach jedem Datenabruf eine zusätzliche vollständige Zeilenkopie vorzuhalten.

### PostgreSQL und Ressourcen

Die Ausführung in `postgres.rs`, `transaction.rs` und `server_output.rs` konsumiert `simple_query_raw` als Stream. Zuvor sammelte `simple_query` zunächst alle Protokollnachrichten in einem Vektor; daraus entstand anschließend das JSON-Ergebnis. Der zusätzliche vollständige Nachrichtenvektor entfällt jetzt. Das Frontend erhält weiterhin dieselbe vollständige Ergebnisstruktur, ohne stilles Abschneiden von Zeilen.

Die Zeitangabe dieser Ausführungspfade schließt jetzt auch die während des Empfangs erfolgende JSON-Aufbereitung ein. Für die Rust-Speicherersparnis wurde kein Prozentwert gemessen.

Die vorhandenen getrennten PostgreSQL-Pools für Abfragen und Metadaten sowie `OnceCell`-Initialisierung wurden geprüft. Eine pauschale Vergrößerung der Pools wurde nicht vorgenommen: Mehr gleichzeitige Datenbankarbeit würde die gemessenen Rendering-Engpässe nicht lösen.

## Prüfung und Reproduktion

```sh
bun run test
bun run build
bun run test:perf
L8DB_PERF_ENGINE=webkit bun run test:perf
```

`test:perf` baut zuerst die App und verwendet deren vollständige Styles und Fonts. Getestet werden schmale und breite Daten- sowie Ergebnistabellen. Der Test fordert tatsächlich gerenderte Zeilen, begrenzt Zeilen- und Zellzahl und prüft FPS, längsten Frame und Mount-Zeit. Zusätzlich prüft ein Bundle-Test, dass der Workspace-Importgraph unter 2 MB bleibt und Monaco nicht enthält.

Die breiten Browserfälle prüfen Scrollen bis Zeile 5.000 und zur letzten Spalte, Spaltenfixierung beim horizontalen Scrollen, Speichern einer Zelle, Abbruch durch Klick in eine andere Zeile sowie lokale Sortierung und Filter. Diese Tests bestehen unter Chromium und WebKit.

Die Frontend-Suite besteht mit 575 Tests; optionale Browser-/Sandbox-Tests werden separat ausgeführt. Typecheck und Produktionsbuild bestehen. `cargo check` und `cargo clippy` bestehen mit vorhandenen Warnungen. Die Rust-Unit-Suite besteht mit 61 Tests und 21 ignorierten Integrationstests über:

```sh
cd src-tauri
TMPDIR=/private/tmp cargo test --lib -- --test-threads=1
```

Der normale parallele Rust-Lauf zeigte Fehler in bestehenden Community-Extension-Dateisystemtests: einen Unterschied zwischen temporärem Pfad und kanonischem Pfad sowie einen Fehler bei einer temporären Installation. Für die erfolgreiche Prüfung wurde ein kanonischer temporärer Pfad und serielle Ausführung verwendet; die Extension-Implementierung wurde dafür nicht verändert.

Auf einer isolierten lokalen PostgreSQL-18-Instanz bestanden zusätzlich `streamed_query_results_preserve_rows_across_execution_paths` mit 10.000 Zeilen und `read_only_connection_rejects_writes`. Der Streaming-Test vergleicht normale Abfragen, Server-Ausgabe und Transaktionen einschließlich NULL-Werten, Reihenfolge, Zeilenzahl und Wiederverwendung nach einem SQL-Fehler. Die Testinstanz wurde anschließend gestoppt.

## Verbleibende Grenzen

- Beliebig große freie SQL-Ergebnisse werden weiterhin vollständig zu JSON und über IPC übertragen. Horizontale Virtualisierung und Streaming beseitigen weder diese Gesamtgröße noch die Erstellung des Zeilenmodells für alle geladenen Zeilen. Ein paginierter Ergebnis- oder Cursorvertrag wäre ein eigener nächster Schritt.
- Ein exaktes `COUNT(*)` kann große Tabellen weiterhin vollständig durchsuchen. Das Ersetzen durch Schätzwerte würde die Semantik der Oberfläche ändern und wurde nicht stillschweigend vorgenommen.
- Das bestehende PostgreSQL-Timeout ist ein clientseitiges Future-Timeout; daraus folgt keine Garantie, dass der Server die laufende Arbeit sofort beendet. Explizite Abbruch- und Wiederverwendungsregeln benötigen gesonderte Integrationstests.
- Große Schema-Sidebars, vollständige Autocomplete-Kataloge, ER-Diagramme und sehr große Auswahl-/Regex-Suchen können weitere Lastspitzen verursachen. Sie sind nicht durch diesen Tabellenbenchmark abgedeckt.
- Gemessen wurden Produktionskomponenten im Browser und ausgewählte PostgreSQL-Pfade. CPU/GPU-Auslastung und Gesamt-RSS des nativen Tauri-Prozesses mit realen SSH-Verbindungen und sämtlichen Datenbankprovidern wurden nicht als Vorher-/Nachher-Vergleich gemessen.

# Performance-Audit, 9. September 2026

Der zweite Durchgang betrifft die Bereiche, die der erste Audit ausdrücklich offen gelassen hatte: große Schema-Sidebars, die Startübersicht und das Dashboard. Ziel war mindestens 60 FPS in der gesamten Oberfläche. Gemessen wurde die gebaute App mit echten Maus- und Tastatureingaben über Playwright, 1.600 × 900 Pixel, gegen eine gemockte Tauri-Bridge mit 3.000 Tabellen, 400 Views, 900 Funktionen, 800 Sequenzen, 600 Rollen und einem Dashboard mit zwölf Charts. Die Bildrate stammt aus `requestAnimationFrame`-Abständen im Dokument selbst.

## Gemessene Ergebnisse

| Szene | Vorher | Nachher, Chromium | Nachher, WebKit |
|---|---:|---:|---:|
| Sidebar, Tabwechsel Tabellen/Views | 41,6 FPS, längster Frame 505 ms | 59,7 FPS, p95 17,8 ms | 57,4 FPS, p95 18,0 ms |
| Sidebar, scrollen | 59,3 FPS, p95 24,6 ms | 60,3 FPS, p95 18,2 ms | 60,3 FPS, p95 17,0 ms |
| Sidebar, Breite ziehen | 10,4 FPS, p95 286 ms | 59,7 FPS, p95 17,4 ms | nicht gemessen |
| Startübersicht, Tabellenliste scrollen | 45,4 FPS, p95 32,0 ms | 59,9 FPS, p95 18,9 ms | 60,7 FPS, p95 18,0 ms |
| Dashboard, scrollen | 53,1 FPS, p95 51,3 ms | 58,8 FPS, p95 25,5 ms | 60,2 FPS, p95 18,0 ms |
| Dashboard, Widget ziehen | 60,4 FPS, p95 18,0 ms | 60,0 FPS, p95 18,3 ms | 60,0 FPS, p95 19,0 ms |
| Tabellenansicht, 5.000 × 50 Zellen, horizontal scrollen | 51,4 FPS (WebKit) | 60,6 FPS | 55,1 FPS |
| Sidebar-Einträge im DOM | 3.000 | 30 | 30 |
| Knoten im DOM auf der Startseite | 27.778 | 1.283 | 1.283 |

Bereits ohne Änderung bei mindestens 59,8 FPS lagen das senkrechte Scrollen der Tabellenansicht, ER-Diagramm mit 120 Tabellen, Sessions mit 500 Einträgen, Monitor, Enums, Sequenzen, Benutzer, ungültige Objekte, Replikation, Query-Builder, Verbindungen, Einstellungen, Info und das Tippen im SQL-Editor.

## Ursachen und Änderungen

- `sidebar-window.tsx` rendert Objektlisten der Sidebar nur im sichtbaren Bereich plus Überhang. Die Zeilenhöhe wird aus dem DOM gemessen, der Rest der Scrollhöhe entsteht über Innenabstände. Listen mit höchstens 60 Einträgen und Listen mit aufgeklappten Spaltentreffern rendern unverändert vollständig. Der eigentliche Aufwand war nicht das Malen, sondern React-Arbeit pro Eintrag, unter anderem ein `matchRoute`-Aufruf je Zeile.
- `connected-dashboard.tsx` zeigt in der Startübersicht höchstens 50 gefundene Tabellen und weist auf die Restmenge hin. Zuvor renderte die Liste alle Treffer in einen 320 Pixel hohen Kasten, jeden Eintrag zusätzlich in einem layout-animierten Container.
- Die Zeilen dieser Liste animieren Hover-Farbe und Pfeil-Deckkraft nicht mehr. Beim Scrollen wandern Zeilen unter dem stehenden Mauszeiger durch; jede dieser Übergangsanimationen erzeugte laufende Repaints im Scrollcontainer. Das Entfernen der beiden Übergänge hebt die Liste von 45,4 auf 59,9 FPS, ohne den Hover-Zustand selbst zu verändern.
- Der Zellinhalt der Tabellenansicht steckte in einem zusätzlichen `truncate`-Container, obwohl die umgebende Zelle bereits abschneidet. Der Container ist entfernt; pro sichtbarer Zelle entfällt damit ein Element, das beim horizontalen Scrollen laufend neu eingehängt wurde.
- `workspace-layout.tsx` lädt die SQL-Intellisense-Synchronisierung wieder verzögert über `React.lazy`. Seit `6788b37` hing Monaco am statischen Importgraphen des Workspace-Layouts und wurde damit auf jeder Arbeitsroute geladen. Der Bundle-Test schlug deshalb fehl; der statische Graph liegt jetzt wieder bei 1,77 MB ohne Monaco. Autovervollständigung, Hover und Definitionssprung im SQL-Editor wurden danach im Browser geprüft.

Verworfen wurde eine Variante, die den scrollenden Container kurzzeitig mit einem Attribut markiert und darüber Übergänge abschaltet sowie Dashboard-Widgets aus dem Hit-Testing nimmt. In Chromium half sie, in WebKit brach das Dashboard damit auf 1,7 FPS ein, weil jede Attributänderung eine vollständige Neuberechnung des Teilbaums auslöste. Da macOS-Tauri WebKit verwendet, wurde die Variante vollständig entfernt. Ebenfalls ohne messbaren Nutzen blieben `will-change: scroll-position`, `contain: paint`, `contain: layout paint style`, `transform: translateZ(0)` und `content-visibility: auto`.

## Prüfung und Reproduktion

```sh
bun run test
bun run test:perf
L8DB_PERF_ENGINE=webkit bun run test:perf
```

`tests/perf-app.test.ts` startet die gebaute App gegen eine gemockte Tauri-Bridge und misst Sidebar-Scroll, Übersichts-Scroll, Sidebar-Tabwechsel, Dashboard-Scroll und Dashboard-Drag. Der Test fordert mehr als 55 FPS, ein 95-Perzentil unter 28 ms, im Dashboard unter 40 ms, sowie ein begrenztes DOM: höchstens 120 Sidebar-Einträge, unter 60 Zeilen in der Übersichtsliste und unter 6.000 Knoten. Die Schwellen sind über `L8DB_PERF_MIN_FPS`, `L8DB_PERF_MAX_P95`, `L8DB_PERF_MAX_P95_DASHBOARD` und `L8DB_PERF_TABLES` anpassbar. Die Schwellen des älteren Tabellentests wurden von 30 auf 55 FPS und vom längsten Frame 250 ms auf 60 ms angehoben. Beide Perf-Testdateien laufen unter Chromium und WebKit.

## Verbleibende Grenzen

- Headless Chromium rastert auf der CPU. Paint-lastige Messwerte sind dadurch pessimistischer als im echten WKWebView unter macOS; die Aussagen zu DOM-Größe und JavaScript-Aufwand sind davon unabhängig.
- Der `requestAnimationFrame`-Zähler ist durch die Bildwiederholrate begrenzt. 60 FPS sind die Obergrenze der Messung; gemessene 58 bis 60 FPS sind der beste erreichbare Bereich.
- Das Dashboard hält in Chromium knapp 59 FPS, hat dort aber je nach Lauf ein 95-Perzentil zwischen 25 und 34 ms. Der Aufwand entsteht beim Hit-Testing der Widgets, während Inhalte unter dem Mauszeiger durchscrollen. Ein `pointer-events: none` auf `.react-grid-item` beseitigt ihn, kostet aber die Bedienbarkeit während des Scrollens und wurde nicht übernommen. In WebKit tritt der Effekt nicht auf.
- Das horizontale Scrollen der Tabellenansicht erreicht in WebKit ab etwa 50 Spalten nur 52 bis 55 FPS, in Chromium 60,6 FPS. Beim Scrollen quer über die Spalten hängt die Spaltenvirtualisierung fortlaufend neue Zellen ein; ein eingefrorener DOM-Klon derselben Tabelle scrollt in WebKit mit 60,6 FPS, die Kosten liegen also im React-Commit, nicht im Zeichnen. Größere Spalten-Batches (8, 16, 24 statt 4), mehr Overscan, der Verzicht auf `tailwind-merge`, statische Zellklassen und flachere Zellcontainer bringen jeweils höchstens ein bis zwei FPS. Der Test fordert für WebKit deshalb nur mehr als 50 FPS beim horizontalen Scrollen; senkrecht und in Chromium bleibt es bei 55.
- Das ER-Diagramm wurde mit 120 Tabellen gemessen. `ReactFlow` läuft ohne `onlyRenderVisibleElements`, und das Fokus-Panel rendert einen Eintrag je Tabelle; sehr große Schemata sind damit nicht abgedeckt.
- Die Sidebar-Virtualisierung setzt eine gleichmäßige Zeilenhöhe voraus. Listen mit aufgeklappten Untereinträgen sind deshalb bewusst ausgenommen und rendern weiterhin vollständig.
- Gemessen wurde die Weboberfläche in headless Chromium und WebKit. CPU-, GPU- und Speicherverbrauch des laufenden Tauri-Prozesses auf echter Hardware wurden nicht erneut erhoben.
