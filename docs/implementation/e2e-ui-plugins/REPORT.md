# Native UI-Plugin-E2E, 5. November 2026

macOS 27.0.1, arm64, Apple M3, 16 GiB RAM. Bun 1.4.3 (abweichend vom Projektziel 1.3.10), echte Tauri-App, agent-desktop 1.0.2 / Protokoll 2.5. Keine CPU-Drosselung. Keine Windows-/Linux-/anderen Datenbankfamilien-Abdeckung. SQLite-Scratch: `/tmp/l8db-ui-e2e/nulls.sqlite`, items mit vier Zeilen, zwei title-NULLs und einem tag-NULL.

## Ergebnisse

| Schritt | Ergebnis | Screenshot (relativ zu diesem Ordner) |
|---|---|---|
| 1 App | ok: vorhandenen tauri-dev auf Port 1420 verwendet; zusätzliche eigene Testinstanz mit SQLite-Datei gestartet | 01-app-after-hmr.png |
| 2 NULL-Daten | ok: temporäre SQLite-Verbindung, vier definierte Zeilen | 02-sqlite-nulls.png |
| 3 Chat | offen: Anbieter Claude Haiku 5.5 antwortet, behauptet aber keine UI-Werkzeuge zu besitzen. Kein fehlender API-Key. Weitere Aktionen direkt per MCP-stdio JSON-RPC tools/call ui_plugins | 03-chat-request.png |
| 4 Freigabe/Filter | Fehler behoben: HTTP-Anzeigefelder machten alle Antworten ungültig. Ablehnen/Übernehmen danach möglich. Button links vor Filter, Spalte title → genau IDs 1 und 3, Abbruch über Close, Reset geprüft. Kombination mit bestehendem Filter nicht nativ abgeschlossen | 04-expired-proposal.png, 04-toolbar-before-filter.png, 04-column-pick.png, 04-only-nulls.png, 04-cancel-pick.png, 04-reset.png |
| 5 Änderungen/Fehler | Fehler behoben: Compilerzeile ging in der Vorprüfung verloren, MCP jetzt „Unexpected token (Zeile 2)“, keine syntax-Datei. Diff geprüft. Endlosschleife übernommen; App bedienbar, table.toolbar mit Laufzeitgrenze abgeschaltet | 05-change-diff.png, 05-syntax-no-file.png, 05-loop-responsive.png, 05-loop-tripped.png |
| 6 Löschen | ok: Einstellungen mit nativer Bestätigung, Datei entfernt. MCP-remove accepted, Datei entfernt. Screenshot des MCP-remove wurde durch Monaco-Absturz überlagert, kein Beleg für dessen Dialog | 06-remove-confirmation.png, 06-mcp-remove-approval.png |
| 7 Bundle | teilweise ok: Exportdatei erzeugt, Plugin gelöscht, dieselbe Datei importiert, Vorschau Neu und Übernahme. Identisch im Export sichtbar. Konfliktimport nicht abgeschlossen. Kaputtes JSON ausgewählt, kein belastbarer Nachweis der Fehlermeldung | 07-export-preview.png, 07-import-new.png, 07-broken-import.png |
| 8 Startschutz | ok: eigene Instanz nach 3 Sekunden SIGKILL, Neustart zeigt Safe Mode, Wieder aktivieren funktioniert | 08-restart-safe-mode.png, 08-restart-reactivated.png |
| 9 Fenster | teilweise ok: echtes zweites Fenster desselben Prozesses; Übernehmen nur im Hauptfenster, neuer Plugin-Eintrag auch im zweiten Fenster vorhanden. Gegenseitiges Umschalten nicht belastbar abgeschlossen | 09-main-approval.png, 09-second-no-approval.png, 09-settings-synced.png |
| 10 Verwaltung | teilweise ok: Leicht, Aktiv, Herkunft KI/Import sichtbar; abgeschalteter Slot mit Meldung. Voll-Installation und gemeinsamer Eintrag nicht geprüft | 10-installed-light.png, 05-loop-tripped.png |

Screenshots dokumentieren den benannten Zwischenstand, nicht automatisch alle Teilbehauptungen. MCP-Rückgaben liegen daneben als *-mcp.json; diese belegen Syntaxzeile und angenommene write/remove-Aktionen. Status „applied“ in diesen Antworten ist keine Aussage über den späteren Slotstatus.

## Behobene Ursachen

`PluginProposals` ergänzt Anfragen um `http`; die Bridge übertrug vorher das gesamte Objekt. Der Backendvergleich gegen die Originalanfrage scheiterte. Die Bridge serialisiert jetzt ausschließlich die vereinbarten Felder. Originalquelltext/Nonce bleiben unverändert; Backendvergleich bleibt streng.

`inspectPluginSource` warf nur error.message weiter. error.line bleibt jetzt als „Zeile N“ erhalten.

## Checks und Performance

- TypeScript: `npx tsc -p tsconfig.app.json --noEmit` erfolgreich.
- Biome: vier eigene geänderte TS-Dateien erfolgreich; vorherige Formatabweichung im neuen Test korrigiert.
- `bun test tests/ui-plugin-proposal-bridge.test.ts`: 1 pass, 102 Assertions. 100 Antworten mit 256 KiB Quelltext, genau 100 Bridge-Aufrufe; median 0,000458 ms, p95 0,002375 ms, Limit p95 <10 ms. Originalquelltext wird referenziert, keine Quelltextkopie; nur sechs begrenzte Metadatenfelder plus Slot. Keine Datenbankabfragen, keine Hintergrundarbeit/Idle-Timer. Mock-Transport ist keine native IPC-Latenzmessung.
- `bun test tests/ui-plugin-proposals.test.ts`: 5 pass, 68 Assertions. Diff 25k+25k Zeilen, n=30, median 14,93 ms, p95 15,65 ms, Limit <100 ms, maxCells=100000 unverändert.
- Keine Rust-Änderung, keine Rust-Checks erforderlich. Keine gedrosselten Tests, keine Vollsuite, kein Build.

## Blockade und Restlauf

Mehrere bereits vorhandene l8db-Prozesse und parallele HMR-Änderungen erschweren die Zuordnung. Native Ansicht stürzte mit Monaco-Service-Initialisierung ab (`_createAndCacheServiceInstance`, `src/lib/monaco/languages.ts:42`, außerdem Versionierungs-Panel). Später lieferte agent-desktop unter der Hauptfenster-ID einen Treffer mit Fensterpfad „l8db“ des Nebenfensters und vorher gültige Refs wurden stale. Keine fremden Versionierungsdateien geändert. Den Restlauf nach paralleler Arbeit mit nur einem frisch gestarteten tauri-dev/Vite durchführen: Chat-Werkzeugentdeckung, bestehender Filter + NULL, Konfliktimport, kaputtes JSON mit Fehlermeldung, bidirektionale Aktivierung und Voll-Erweiterung. Diese Punkte sind ausdrücklich offen und nicht als erfolgreich bewertet.

Alle selbst gestarteten App-Prozesse beendet; die vorgefundene Instanz bleibt laufen. Eigene e2e-*.tsx und eigene Vorschlagsverzeichnisse aus ~/.l8db/ui entfernt; keine fremden Plugins entfernt. Eigene Download-Dateien entfernt. SQLite und Export im Scratch erhalten. Kein Review-Subagent.


## Runde 2

5. November 2026: Nachtest vor dem App-Start blockiert. `AGENTS.md`, `CLAUDE.md` und Skill `agent-desktop` gelesen; agent-desktop 1.0.2 meldet Accessibility und Screen Recording als granted.

Die vorgeschriebene erste Prozessprüfung (`lsof -i :1420`, `pgrep -fl l8db`) ergab eine fremde Vite-Instanz PID 79862 auf Port 1420, `tauri dev` PID 79715 sowie `target/debug/l8db` PID 58455. Zusätzlich lief die installierte App mit `--mcp` (PID 87021). Keine dieser Instanzen wurde von diesem Lauf gestartet. Gemäß ausdrücklicher Vorgabe wurde keine beendet und keine vorhandene Instanz zum Testen verwendet. Eine eigene frische `bun run tauri dev`-Instanz konnte daher nicht gestartet werden.

| Punkt | Ergebnis Runde 2 | Screenshot |
|---|---|---|
| 1 KI-Chat einschließlich discover_tools/api/write/Freigabe/NULL-Filter | offen: fremde Instanz belegt Port 1420 | keiner, kein App-Nachtest |
| 2 Bestehender Filter + NULL-Button | offen: gleicher Startblocker | keiner |
| 3 Konfliktimport: Diff, Überschreiben, Überspringen | offen: gleicher Startblocker | keiner |
| 4 Kaputte Bundle-Datei: UI-Fehler | offen: gleicher Startblocker | keiner |
| 5 Bidirektionale Fenster-Synchronisierung | offen: gleicher Startblocker | keiner |
| 6 Volle Erweiterung: Stufe, Status, Rechte, Ein/Aus | offen: gleicher Startblocker | keiner |

Keine Aussage über Erfolg oder Fehler der sechs Funktionen möglich. Insbesondere keine erneute Modellverweigerung beobachtet und daher keine Prompt-/Katalogänderung vorgenommen. Keine Runtime-Dateien geändert; keine Regressionstests oder Token-Benchmarks erforderlich bzw. ausgeführt. Keine gedrosselten Performance-Tests auf macOS. Keine eigenen App-Prozesse, Testplugins oder Screenshots erzeugt; entsprechend nichts zu beenden oder aus `~/.l8db/ui/` zu entfernen. Keine fremden Dateien oder Plugins verändert. Kein Review-Subagent. Für die Fortsetzung muss Port 1420 durch den Eigentümer der laufenden Instanz freigegeben werden.

## Runde 3

5. November 2026, ab 18:19 CET. Vorhandene Dev-Instanz ausdrücklich zur Nutzung freigegeben; keine zweite Instanz gestartet, keine Instanz beendet und kein Neustart ausgelöst. AGENTS.md, CLAUDE.md und agent-desktop-Skill einschließlich macOS-/Systemreferenz gelesen. Keine fremden Dateien verändert.

Stand: Start-HEAD `d8bfc63b8ee37455ece06c0bd78bf0a921e8936f` (`docs: Startblockade des UI-Plugin-Nachtests dokumentieren`). `git merge-base --is-ancestor 4ce941cb HEAD` war erfolgreich. Commit `4ce941cb` datiert auf **18:17:42 +0100**. App PID **58455** (`target/debug/l8db`) startete um **18:16:40** und enthält daher den neuen Rust-Stand nicht nachweislich. Für Punkt 1 ist ein App-Neustart nötig. `bun tauri dev` PID 79714 und Vite PID 79862 liefen unverändert seit 16:05:57.

Zusätzliche native Blockade: Accessibility und Screen Recording sind granted, aber `snapshot --app l8db` liefert `WINDOW_NOT_FOUND`. Die globale Fensterliste zeigt zu PID 58455 ausschließlich `w-20996`, Titel `l8db`, unsichtbar, `accessible:false`, Geometrie x=-1470/y=0, 1470×33. `list-windows --app l8db` liefert eine leere Liste. Gezieltes `focus-window` und ein frischer Snapshot dieser ID liefern `ACTION_NOT_SUPPORTED`, `kind:window_without_accessibility_element`. Auch `snapshot --surface menubar --app l8db` findet kein Fenster. Der Screenshot der ID ist lediglich 2940×66 Pixel groß und belegt kein App-Inhaltsfenster. Keine fremde Anwendung aktiviert oder ein zusätzlicher App-Prozess gestartet, um diese Blockade zu umgehen. Im Prozessinventar existiert außerdem l8db PID 87021 (MCP); dieser wurde nicht benutzt.

| Punkt | Ergebnis Runde 3 | Screenshot |
|---|---|---|
| 1 KI-Chat: discover_tools/api/write/Freigabe/NULLs | offen: Rust-Prozess älter als 4ce941cb; Neustart nötig; zusätzlich kein zugängliches Inhaltsfenster | r3-window-unavailable.png (nur Fensterrest, kein Funktionsbeleg) |
| 2 Bestehender Filter + NULL-Button | offen: kein bedienbares Inhaltsfenster | gleicher Blockadebeleg |
| 3 Konfliktimport: Diff/Überschreiben/Überspringen | offen: kein bedienbares Inhaltsfenster | gleicher Blockadebeleg |
| 4 Kaputte Bundle-Datei: Fehlermeldung | offen: kein bedienbares Inhaltsfenster | gleicher Blockadebeleg |
| 5 Aktivierung bidirektional in zwei Fenstern | offen: kein bedienbares erstes Fenster; zweites nicht geöffnet | gleicher Blockadebeleg |
| 6 Volle Erweiterung: Stufe/Status/Rechte/Ein-Aus | offen: kein bedienbares Inhaltsfenster; nichts installiert | gleicher Blockadebeleg |

Keine erneute Modellverweigerung oder Monaco-Ausnahme beobachtbar; ohne Inhaltsfenster ist auch deren Abwesenheit nicht belegt. Keine Runtime-Änderungen, deshalb keine Regressionstests, Token-Benchmarks oder Buildchecks ausgeführt. Keine Performance-Messung und keine CPU-Drosselung. Plattform wie oben: macOS/arm64; keine weitere Plattform- oder Datenbankabdeckung. Keine neuen Testdaten, temporären Verbindungen, Testplugins oder Erweiterungen angelegt, kein zweites Fenster geöffnet; entsprechend keine Bereinigung erforderlich. Die drei genannten Dev-Prozesse blieben erhalten. Kein Review-Subagent. Fortsetzung benötigt ein zugängliches App-Inhaltsfenster und für Punkt 1 einen vom Eigentümer ausgelösten Neustart mit aktuellem Rust-Stand.
