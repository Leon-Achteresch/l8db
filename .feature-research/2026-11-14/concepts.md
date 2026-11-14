# Produktverständnis und Konzepte

## Ausgangspunkt

Native Desktop-Arbeitsumgebung für Datenbankentwickler, technische Analysten und DB-Administratoren; Team-/Kundenrollouts und Oracle-Werkzeuge erweitern den Fokus. Dies ist aus README, Feature-Katalog und Architektur abgeleitet, nicht durch Nutzerinterviews validiert. PostgreSQL ist der vollständigste Pfad. Provider-Fähigkeiten begrenzen die anderen Familien; keine generische Gleichheit versprechen.

React 19/TanStack Router/Zustand → zentrale Bridge `src/lib/db/` → Tauri/Rust → Provider-Adapter. SSH/Proxy über effektive URL ohne direkten Fallback. Lokale Zustände in IndexedDB; fensterübergreifende Synchronisierung nötig. Große Tabellen/Exporte sind begrenzt und bedarfsgesteuert. Visuelle Sprache: kompakte IBM-Plex-Sans-Oberfläche, wenige Linien, getönte Flächen, bestehender FK-Drawer statt neuer Vollbild-Tools.

## Codeprüfung statt Dubletten

- `src/lib/discovery/catalog-entries.ts`, `docs/workbench-qol.md`: SQL-Stände, Parametersätze, Arbeitsstände und Beobachtungen existieren.
- `src/features/table/timestamp-display-menu.tsx`: Original/UTC/lokale Zeit bereits vorhanden.
- `src/features/explain/plan-comparison-panel.tsx`: Planvergleich vorhanden.
- `src/lib/column-profile.ts`: Histogramme/NULL/Distinct für geladene Werte vorhanden.
- `src/lib/connections/cloud-auth.ts`: IAM/Entra vorhanden; `docs/release-1.0.md` in diesem Punkt veraltet.
- `src/lib/fk-drawer-stack.ts`, `src/features/table/fk-drawer-stack.tsx`: FK-Navigation bereits vorhanden; lokale explizite Beziehungen wären die Erweiterung.
- `src/features/export/data-export-dialog/use-data-export.ts`: Full-/Loaded-Pfade, Warnung bei Kürzung und Masken vorhanden; dauerhafter Abschlussbeleg nicht gefunden.
- `src/lib/connection-state.ts`: Status aus Aktivierung abgeleitet; keine Diagnose pro Verbindungsstufe.
- `src/lib/ssh/tunnel-failures.ts`: Tunnel-Reconnectwarnungen existieren. Neu wäre Diagnose/Einordnung, nicht automatisches Reconnect.

Kein graphify-Graph und kein installiertes graphify gefunden. Skill gelesen; keine Installation/Generierung außerhalb des erlaubten Ordners. Beziehungsanalyse erfolgt direkt anhand dieser Importe und Aufrufer, kein behaupteter graphify-Lauf.

## Forschungsdurchlauf

Runde 1: Bestandsaufnahme und Problemcluster. Runde 2 prüft Konkurrenz-Fixes, tatsächliche Neuheit und schwächste Nachfrageannahmen. Keine Nutzungs- oder Performancegewinne gemessen; geplante Budgets sind Abnahmekriterien für spätere Umsetzung.

## 1 · Export-Herkunft und Abschlussbeleg

**Job:** „Ich übergebe Daten und muss erkennen können, welchen Stand und welchen Ausschnitt die Datei enthält.“ Evidenz: S01–03/S09 in [sources.md](sources.md). Lösung und Priorisierung sind unsere Schlussfolgerung; kein Beleg für Zahlungsbereitschaft.

**MVP:** bestehende Exportfläche um die Wahl **Geladene Zeilen / Neu lesen** ergänzen. „Geladen“ nennt Zeitpunkt, Anzahl und Teilmengenstatus und löst keine DB-Abfrage aus. „Neu lesen“ ist nur bei vorhandener Fähigkeit verfügbar, nennt Filter, Limit und neue Leseausführung. Abgeschlossenes Ergebnis mit Zeilenzahl, Quelle, Format, ausgewiesener Kürzung, Maskierungsstatus und Zeitpunkt bleibt als kompakter Beleg verfügbar. Kleine lokale JSON-Datei optional, standardmäßig ohne SQL, Filterwerte, Host oder Zeilendaten. Keine zusätzlichen COUNT-Scans.

**Nicht im MVP:** neuer Exportmotor, beliebiges SQL für alle Familien, automatisches Nachladen, Export-Cloud-Service, signierter Auditnachweis, zusätzliche Exportformate. Ein Hash beweist höchstens Dateiintegrität und nicht Vollständigkeit der Datenbank; zunächst keinen anbieten.

**Akzeptanzkriterien:**

1. Bei 100 geladenen Zeilen aus gekürztem Ergebnis sagt der Beleg „Teilmenge, Gesamtzahl unbekannt“; exakt 100 werden exportiert; null Datenbankanfragen.
2. Neu lesen friert Verbindung, Datenbank, Filter, Sortierung, Masken und Limit zum Start ein. Ein Verbindungswechsel schreibt nie Daten vom neuen Ziel in denselben Job.
3. Grenzfall N exakt und N+1 unterscheiden sich korrekt anhand bestehender Trunkierungsinformation. Kein „vollständig“, nur weil N Zeilen geschrieben wurden. Vollständigkeit bezieht sich auf die ausgewählte Abfrage.
4. Fehler/Abbruch erhalten die alte Zieldatei gemäß bestehendem Atomic-Writer. Es entsteht kein Erfolgsbeleg. Ein separat fehlgeschlagener Belegexport macht einen abgeschlossenen Datenexport nicht nachträglich zum Datenfehler.
5. Unsupported-Provider zeigen einen klaren Grund für fehlendes „Neu lesen“. Loaded-Export bleibt nutzbar. Maskierung respektiert bestehende Regeln, ohne Rohwerte im Beleg.
6. Wiederholtes Öffnen des Belegs führt keine SQL aus; lokale Historie ist optional, hart begrenzt und löschbar. Fenster-Synchronisierung ist erforderlich, falls persistiert wird.

**Umsetzungseinstieg:** zunächst Rückgabe-/Zustandsmodell für den vorhandenen Exportpfad vereinheitlichen, danach Quellenwahl und Belegkomponente. Es braucht keine neue Route. Feature-ID-Vorschlag `table.export.receipt` bzw. Result-Export im vorhandenen NEW-System; Version erst beim tatsächlichen Release festlegen.

**Geplante Leistungsabnahme, keine Messwerte:** vorhandenen Exportfall mit 1 Mio. Zeilen verlängern; Belegbildung in 40 Läufen Median <5 ms/p95 <15 ms, maximal 8 KiB Metadaten, maximal 100 Belege/1 MiB, keine zweite Datenkopie. Bestehende Cursor-Batch-/Speicherbudgets unverändert. DB-Anfragen vor/nach identisch, kein zusätzliches COUNT. Abbruch entsorgt Listener und temporären Writer, Idle null Jobs. Reale Streaming-Benchmarks getrennt von Metadaten-Benchmark ausweisen.

**Mockup:** [01-export-beleg.html](mockups/01-export-beleg.html). Quellenwahl, Limits, simuliertes Exportieren/Abbrechen, Leer-/Fehler-/Erfolgszustand und herunterladbarer Demo-Beleg. Die sichtbaren drei Zeilen sind eine Vorschau aus 100 simulierten geladenen Zeilen. Keine echten Dateien mit Daten werden erzeugt.

## 2 · Verbindungsdiagnose in Stufen

**Job:** „Im Terminal geht es, im Client nicht. Welche Stufe scheitert, und was kann ich gezielt prüfen?“ S04/S05 stützen die Aufgabe; S06 ergänzt einen anderen Recovery-Fall. Der Fehler in einem Electron-RPC-Layer wird nicht auf Tauri übertragen.

**MVP:** bewusster einmaliger Diagnoseaufruf für PostgreSQL direkt und über vorhandenes SSH. Schritte Netzwerk, SSH falls verwendet, TLS, Anmeldung, minimale Datenbankprobe. Jede Stufe zeigt erfolgreich/fehlgeschlagen/übersprungen/unbekannt und ihre verfügbare Dauer. Detail nennt eine belegbare Handlung. Bericht kann vor Download auf sensible Inhalte reduziert werden; rohe Connection-Strings und Schlüsselpfade werden nicht eingebettet.

Die reale Reihenfolge wird von Route und Treiber bestimmt: mit Proxy/SSH kann DNS am Sprungserver aufgelöst werden. Man kann Netzwerk/TLS/Auth nicht immer unabhängig messen. In diesem Fall zeigt die Oberfläche eine kombinierte Stufe. Keine künstlich genaue Zeit oder Ursache aus einem einzigen Fehlerstring ableiten.

**Nicht im MVP:** vollständiger OpenSSH-Config-Interpreter, generischer Auto-Fixer, Umstellen auf unsicheren TLS-Modus, Hintergrundpolling, neue Tunnelimplementierung, automatisches Wiederholen einer Nutzerabfrage. Unklarer Commit-Status bleibt „unbekannt“; ein erfolgreicher Diagnosetest beweist den Commitstatus nicht.

**Akzeptanzkriterien:**

1. Testszenarien DNS/Port nicht erreichbar, Host-Key-Konflikt, Key/Auth-Fehler, fehlende CA, Hostname falsch, DB-Passwort falsch und fehlende Datenbank werden soweit treiberseitig belegt der richtigen Stufe zugeordnet.
2. Jeder Lauf hat ID und Abbruchsignal. Schließen/Verbindungswechsel verwirft verspätete Ereignisse. Abbruch ist nicht Erfolg und startet keine nächste Stufe.
3. Maximal eine temporäre Diagnosesitzung; kein Entfernen/Ersetzen einer Sitzung, die ein anderes Fenster benutzt. Keine direkte Fallback-Verbindung bei fehlgeschlagenem Tunnel.
4. Bericht enthält Provider/Driver/App-Version, Stufencodes und redigierte Meldung. Kein SQL, Token, Passwort, privater Schlüssel oder unredigierter URI; Nutzer kann den Inhalt vor Speichern sehen.
5. Kein Commit/Rollback-Versprechen bei Netzabbruch. Test verändert keine offene Nutzertransaktion; minimale Probe läuft getrennt. Erneuter Test ist ausdrücklich durch Klick ausgelöst.
6. Nicht unterstützte Detaildiagnose sagt das deutlich; normaler Verbindungstest bleibt erreichbar.

**Umsetzungseinstieg:** ein typisiertes Backend-Ereignismodell um den bestehenden Verbindungstest legen, instrumentierbare Stufen zuerst erfassen; dann vorhandene Teststatusfläche erweitern. Fehlerklassifizierung ohne reproduzierbaren Treiberbeleg bleibt „unbekannt“. Mögliche Feature-ID `connections.diagnostics.stages`.

**Geplante Leistungsabnahme:** 1.000 synthetische Diagnoseereignisse, 40 Wiederholungen, lokales Reduzieren Median <10/p95 <25 ms; höchstens 100 Ereignisse/64 KiB pro Bericht, 20 Berichte. Pro Klick höchstens eine Sitzung, ein aktiver Job, eine minimale Probe; übersprungene Stufen keine Requests. Kein Heartbeat/Idle-Traffic. Abbruch verhindert weitere Probes und schließt nur eigene Ressourcen. Reale DNS-/Netzwerklatenz separat messen, kein synthetisches Zeitlimit als Netzwerkbenchmark deklarieren.

**Mockup:** [02-verbindungsdiagnose.html](mockups/02-verbindungsdiagnose.html). Stufen auswählbar, TLS-Fehler, korrigierte CA als Demo-Schalter, erneute Prüfung, Abbruch und redigierter Bericht. Alle Zahlen sind synthetisch.

## 3 · Import-Prüflauf ohne Schreiben

**Job:** „Ich möchte die problematischen Stellen einer fremden Datei sammeln, bevor ich denselben Import mehrfach versuche.“ Aktuelle Berichte S11/S12 beschreiben fehlende Ursacheninformationen, S13 unklaren Zeilenstatus. Sie fordern diese exakte Lösung nicht explizit.

**MVP:** CSV vollständig mit vorhandenem Streamingparser lesen, Struktur/Spaltenanzahl und konservative Regeln für Integer, Numeric und explizite NULL-Verletzungen prüfen. Mehrere Probleme in begrenzter Liste nach Dateizeile/Spalte/Regel sammeln; Bericht standardmäßig ohne Originalwerte. Ein fehlerfreier Prüflauf heißt **keine lokalen Fehler**, nicht „Import garantiert“. Zielspalten können einmal über den existierenden Katalog gelesen werden; Prüflauf selbst macht keine Schreibzugriffe.

**Nicht im MVP:** XLSX-Vollscan, Datenbereinigung, Auto-Fix, Skip-bad-rows-Modus, vollständige Datenbankvalidierung, INSERT-und-Rollback als angeblich nebenwirkungsfreier Test. Der Prüflauf behebt keinen Beekeeper-Treiberbug. Er adressiert früheres Verstehen des eigenen Imports.

**Akzeptanzkriterien:**

1. Eine Datei mit 50.000 Datensätzen und Fehlern in Zeilen 813, 12.409 und 41.028 liefert alle drei lokalen Fundstellen und null INSERT/UPDATE/DELETE/DDL. CSV-Dateizeile und logische Datensatznummer bleiben bei mehrzeiligen Feldern unterschieden.
2. UI nennt gelesene, geprüfte und geschriebene Zeilen separat; geschrieben bleibt 0. Bei Abbruch/Parserstop wird die Abdeckung als unvollständig angezeigt.
3. Datei, Größe/Modifikation/Fingerprint, Mapping, Optionen oder Zielmetadaten geändert → altes Ergebnis ungültig. Tatsächlicher Import liest erneut; zwischen Prüfung und Import kann sich die Datei ändern. Ein Fingerprint allein ersetzt keine sichere Dateiöffnung/Prüfung.
4. Nicht prüfbare Typen sowie Unique/FK/Trigger/Default-Ausdrücke werden ausdrücklich als nicht geprüft aufgeführt. Kein Simulieren von Datenbankkollationen oder jeder zulässigen Datumsschreibweise.
5. Bestehender Import bleibt eigener Freigabeschritt und Quelle seiner endgültigen Schreib-/Rollback-Zahlen. Ein grüner lokaler Bericht startet keinen Import automatisch.
6. Höchstens 1.000 Details/1 MiB; Gesamtfehlerzähler darf weiter steigen, abgeschnittene Details werden ausgewiesen. Maskierung gilt auch für Vorschau und Berichtexport.

**Umsetzungseinstieg:** wiederverwendbaren Event-Sink für Parser/Typprüfung vor den vorhandenen Batchwriter setzen, ihn für den Prüflauf ohne Writer verwenden. Kein separater CSV-Parser im Frontend. Zuerst CSV/PostgreSQL-Zielmetadaten, dann erst weitere Familien anhand belegter Regeln. Feature-ID-Vorschlag `import.csv.preflight`.

**Geplante Leistungsabnahme:** 1 GiB CSV / 1 MiB maximaler Record unter bestehendem Dateilimit, ein Reader, begrenzte Problemliste, keine Speicherung ganzer Datei. UI-Eventverarbeitung Median <5/p95 <15 ms bei höchstens vier Fortschrittsereignissen/s; Parserdurchsatz gegen denselben Parser ohne Diagnose erfassen, vorgeschlagen maximal 15 % Zusatzzeit. 50.000-Zeilen-Fehlerdatei und Fehlerflut separat. Maximal eine Metadatenabfrage, sonst null DB-Anfragen. Abbruch stoppt Reader vor nächstem Batch; keine Idle-Scans, kein weiterlaufender Dateihandle. Reales RSS/CPU messen, keine Textgrößen als Heapnachweis ausgeben.

**Mockup:** [03-import-prueflauf.html](mockups/03-import-prueflauf.html). Fehlerliste, korrigierte Datei, Optionsänderung invalidiert Bericht, Abbruch, Erfolg mit eingeschränkter Aussage und lokaler Fehlerbericht. „Import prüfen…“ zeigt nur den nächsten konzeptionellen Schritt; dieser Prototyp führt keinen Import aus.

## Gestaltungsentscheidung und Abnahme

Angewendeter Design-Skill: `premium-ui`; Geschmackreferenzen `2095860447018975618_1` und `2096997673135911371_1` über `design_references`. Übernommen: ruhige Sidebar, kompakte Tabellen, kleine Metadaten, präzise Statusanzeigen und Pills. Projekt hat Vorrang: IBM-Plex-Sans-Stack mit System-Fallback statt externer Fontabfrage, zurückhaltendes Blau statt neu eingeführter Lime-Marke, wenige Linien statt Kartenraster. Alle Dateien funktionieren ohne Server, Build oder externe Assets. HTML/Body-Hintergrund bleibt für T3-Einbettung transparent; innere Arbeitsflächen nutzen Tokens.

Ein gebündelter visueller Review, ein Korrekturdurchgang: Diagnose-Schrittauswahl stärker unterschieden und passive Step-Flächen reduziert; Preview-Anzahl explizit gemacht; Importzähler bei ungeprüft/laufend korrigiert; falsches Trennzeichen bekommt eigenen Strukturfehler; Exportbeleg nennt dynamische Batchanzahl. Kein zweiter konzeptioneller Review.

Validierung und genaue Grenzen stehen im [Prüfprotokoll](validation.md). Es wurden weder Produktcode noch echte Datenbankadapter verändert. Die vorgeschlagenen Performancebudgets oben sind Ziele für spätere Umsetzung und ausdrücklich keine gemessenen Ergebnisse der Mockups.

## Nächster Recherchezyklus

Fokus auf **Exportverständnis statt weitere Features**: aktuelles DBeaver-Verhalten nach #39998 und TablePlus-/DataGrip-Exportpfade anhand öffentlich verfügbarer Dokumentation vergleichen. Danach mit 3–5 tatsächlichen l8db-Nutzern die Entscheidung „geladene Zeilen / neu lesen“ und die Interpretation eines gekürzten Belegs prüfen, sobald Nutzerzugang autorisiert wird. Ohne Nutzerzugang weitere unabhängige Originalfälle aus 2026 sammeln; keine Reichweite oder Zahlungsbereitschaft aus Issuezahlen ableiten.
