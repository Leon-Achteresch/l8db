# Redis-/Valkey-Integration und lokaler Test

Redis und kompatible Standalone-Server verwenden den eingebauten Redis-Adapter. Verbindungen sind über `redis://`, `rediss://` und `valkey://` möglich; Benutzername, Passwort und Datenbanknummer werden aus der URL übernommen. Der vorhandene SSH-Transport bleibt vorgeschaltet, wenn ein Tunnel konfiguriert ist.

## Bedienung

- Datenbank im linken Auswahlfeld wählen, anschließend `keys` öffnen.
- Rechtsklick auf den Spaltenkopf `key` → `Filter setzen…`: Gleichheit, Enthält, Beginnt mit und Endet mit. Sonderzeichen werden bei diesen Textfiltern wörtlich behandelt. Andere Spalten unterstützen derzeit keinen Serverfilter.
- Der separate Pattern-Filter akzeptiert Redis-Glob-Patterns, beispielsweise `user:*`, `session:??` oder `item:[0-9]*`.
- Keys werden aufsteigend oder absteigend sortiert und seitenweise angezeigt. Die Sortierung gilt über alle gefundenen Keys, nicht nur über einen einzelnen SCAN-Aufruf. Andere Spalten bieten keine Serversortierung an.
- Doppelklick auf `key`, `ttl` oder einen vollständigen textuellen String-Wert öffnet die Zellbearbeitung. Leerer Text bleibt ein leerer Redis-String; eine leere TTL entfernt die Ablaufzeit. Der Zellendialog unterstützt mehrzeiligen Text. String-Änderungen vergleichen den ursprünglichen Wert atomar per Lua und erhalten die TTL. Zwischenzeitlich geänderte Werte und Namenskollisionen werden abgewiesen. Die Redis-ACL muss die jeweiligen Befehle einschließlich EVAL erlauben.
- Metadaten, binäre/gekürzte Vorschauen und Sammlungswerte sind in der Tabelle schreibgeschützt; für Sammlungsänderungen dient `Key verwalten`.
- `Key verwalten` liest vollständige Werte und unterstützt String-Werte, Hash-Felder, Listen, Sets, Sorted Sets und Stream-Einträge. Dort lassen sich auch Keys umbenennen, Ablaufzeiten setzen/entfernen und Keys löschen. Ein vorhandener Ziel-Key wird beim Umbenennen nicht überschrieben. String-Updates erhalten bestehende TTLs.
- Weitere Redis-Befehle, einschließlich einzelner Feld-/Elementlöschungen, Lua, Serverinformationen und `PUBLISH`, können im Editor ausgeführt werden. Ein Befehl pro Zeile; `#` am Zeilenanfang kennzeichnet Kommentare. Doppelte Anführungszeichen unterstützen unter anderem `\n`, `\r`, `\t` und `\xHH`. Semikolons sind keine Befehlstrenner.
- Der Editor verwendet pro Ausführung eine eigene Verbindung. Datenbankwechsel mit `SELECT`, Authentifizierung und Transaktionszustände beeinflussen deshalb keine anderen Abfragen oder den Key-Browser. `MULTI` und `EXEC`/`DISCARD` müssen innerhalb derselben Ausführung stehen.
- „Alle Keys löschen“ im Kontextmenü leert nach Bestätigung ausschließlich die ausgewählte Datenbank mittels `FLUSHDB`.

Beispiel für den Editor:

```text
SET user:1 "Ada Lovelace" EX 600
GET user:1
HSET profile:1 name "Ada" role admin
HGETALL profile:1
MULTI
INCR counter:1
EXPIRE counter:1 600
EXEC
```

## Anzeigegrenzen und Funktionsumfang

Die Key-Übersicht zeigt maximal 100 Elemente einer Sammlung beziehungsweise 4 KiB eines Strings. `size` enthält die Gesamtzahl der Elemente beziehungsweise Bytes; `truncated` kennzeichnet eine gekürzte Vorschau. Binärdaten erscheinen im Hexformat `\x…`. Der Tabellenexport exportiert die angezeigten Daten einschließlich dieser Vorschauen, keinen vollständigen Redis-Backup.

Für stabile Seiten wird der passende Key-Bestand vollständig über SCAN durchlaufen und dedupliziert. Bei mehr als 100.000 passenden Keys fordert die App ein engeres Pattern an. Änderungen am Server zwischen Seitenaufrufen können den Bestand verändern; SCAN ist kein Snapshot. Befehle haben ein Zeitlimit von 30 Sekunden. Fehlgeschlagene Schreibbefehle werden nicht automatisch wiederholt.

Wenn `CONFIG GET databases` nicht erlaubt ist, werden Datenbanknummern auf einer separaten Verbindung geprüft, bis der Server eine Nummer ablehnt (maximal 1024). Ist auch `SELECT` verboten, bleibt die aktuelle Datenbank auswählbar.

Der Funktionsumfang betrifft Standalone-Redis und dessen sechs grundlegende Key-Typen. Cluster-/Sentinel-Topologien, modulspezifische grafische Editoren und dauerhafte Pub/Sub-/MONITOR-Ansichten sind nicht implementiert. Dauerhafte Subscriptions und MONITOR werden im Abfrageeditor ausdrücklich abgewiesen. `rediss://` und SSH verwenden die vorhandenen Transportwege; der hier beschriebene Labortest validiert keine TLS-Zertifikatskette und keinen echten SSH-Tunnel.

## Reproduzierbarer Integrationstest

Voraussetzungen: laufendes Docker, Rust-Toolchain, Bun 1.3.10, installierte Projektabhängigkeiten und die Playwright-Browser Chromium und WebKit. Die Ports 6381, 6382 und 1420 müssen frei sein.

```sh
bun run test:redis
L8DB_REDIS_VARIANT=valkey bun run test:redis
```

Der Test erstellt einen eigenen Redis-7- bzw. Valkey-8-Container mit 32 Datenbanken, startet den Rust-Testadapter und Vite, führt die Backend- und Oberflächentests aus und entfernt anschließend seine Prozesse und den Container. Bestehende Dienste auf den benötigten Ports werden nicht beendet.

Geprüft werden:

- Verbindung, Metadaten, Datenbankwechsel und Isolation.
- Lesen, Schreiben und Löschen der sechs Standardtypen; Rename, TTL und FLUSHDB.
- Unicode, Leerzeichen, Anführungszeichen, binäre Werte/Keys und Schutz vor eingeschleusten Befehlszeilen.
- Pagination über 2.505 Keys in beide Richtungen und Pattern-Zählung.
- Vorschauen großer Werte und RESP2-/RESP3-Antworten.
- Authentifizierung, falsches Passwort, ACL-Fehler und Datenbankerkennung ohne CONFIG-Recht.
- Wiederherstellung einer abgebrochenen Leseverbindung und Isolation von MULTI/SELECT.
- Verbindungstest, Darstellung, Pattern- und Key-Spaltenfilter, direkte Zellbearbeitung (String, leerer String, mehrzeiliger Dialog, TTL, Rename), Namenskollisionen, konkurrierende Änderungen, Key-Aktionen, Befehlseditor, Fehleranzeige und Datenbankleeren in Chromium und WebKit. Gespeicherte Werte werden über den echten Adapter zurückgelesen.

Die Browserprüfungen führen echte Redis-Operationen über den Rust-Adapter aus. Nur der Tauri-IPC-Transport wird durch eine lokale Testbrücke ersetzt; OS-Keychain und native Fensterintegration werden dabei nicht getestet. Die Brücke wird ausschließlich als ignorierter Rust-Test kompiliert und akzeptiert nur die lokale Vite-Origin und das lokale Redis-Labor.

Die ignorierten Backendtests können alternativ mit `L8DB_E2E_REDIS_URL` ausgeführt werden. Sie dürfen ausschließlich auf einer eigenen Testinstanz laufen: Sie leeren Datenbanken 11, 13 und 14 und erstellen/löschen einen Test-ACL-Benutzer. Die Browsertests leeren Datenbanken 0 und 1.

## Nachprüfung am 10. September 2026

Der erste Redis-Test prüfte Pattern-Filter und das separate Dialogfenster `Key verwalten`, aber keine direkte Zellbearbeitung und keinen Spaltenfilter. Die anschließende Valkey-Rückmeldung zeigte diese Lücke. Die direkten Tabellenaktionen wurden ergänzt und die Browserprüfungen entsprechend erweitert.

Die Nachprüfung verwendet echte Standalone-Server hinter dem Rust-Adapter; native Tauri-Fenster, Keychain, TLS und SSH bleiben außerhalb dieses Browsertests.

Ergebnisse der Nachprüfung:

- Redis 7 und Valkey 8: jeweils 6 Backendtests und die erweiterten Browserabläufe in Chromium und WebKit bestanden; keine JavaScript-Laufzeitfehler.
- 4 Befehls-/Filtertests bestanden. Exakte Key-Filter wurden auch mit Leerzeichen und literalen Glob-Sonderzeichen gegen den Server geprüft.
- Allgemeine Frontendtests: 741 bestanden, 21 optionale Tests übersprungen, keine Fehler.
- Bestehender Browser-Regressionsablauf `table-edit-browser.test.ts`: bestanden.
- Typecheck, Produktionsbuild, `production:check`, Rust-Formatprüfung und `git diff --check`: bestanden.
- Biome: keine Fehler, 336 bestehende Projektwarnungen; der Build meldet weiterhin große Bundles.
- Keine Commits erstellt.
