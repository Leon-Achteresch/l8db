# UI-Plugin-Fix-Runde, 2026-11-05

Findings 3–10 und a–c umgesetzt. Finding d verworfen: Der dauerhafte
Execution-Guard-Latch verhindert, dass Plugin-Code den Abbruch abfängt und
weiterläuft. Findings 1–2 waren bereits in 8056eef0 behoben.

Vorprüfung kompiliert und instrumentiert, wertet aber keinen Plugin-Code aus.
Metadaten müssen statisch lesbar sein: direktes Exportobjekt oder
definePlugin mit Objektliteral, feste ID und feste HTTP-Liste. Dynamische
Definitionen benötigen Anpassung vor Galerie-/Bundle-/Proposal-Import.
Die vollständige Definition wird erst beim genehmigten Laden validiert.
Offene Vorschläge cachen ihre Prüfung nach Nonce und exaktem Quelltext
(kollisionsfreie Inhaltsidentität); geschlossene Einträge werden entfernt.

MCP reiht bis zu 64 Nachrichten zusätzlich zum Kanal mit acht Einträgen ein,
danach greift Backpressure. Client-Antworten bleiben unbeantwortet. Die
Bearbeitung bleibt sequenziell, Cancellation laufender Arbeit bleibt möglich.
Proposal-Anwendung und Antwort erfolgen im selben Backend-Aufruf, unabhängig
vom anschließenden Reload; Wiederholung des bereits erreichten Dateizustands
ist erfolgreich.

## Messungen

Darwin arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. Keine Drosselung.
Keine Aussage zu anderen Betriebssystemen oder Datenbankfamilien.
Bun-Dateien einzeln ausgeführt, damit Tauri-Mocks nicht zwischen Dateien
durchsickern. Ein erster gemeinsamer Lauf unter dem vorinstallierten Bun 1.4.3
zeigte Mock-Kollisionen und Reload-p95 3,58 ms bei Budget <2 ms.
Keine Budgets verändert. Der abschließende Lauf unter vorgeschriebenem
Bun 1.3.10 ist grün.

- 200 × 8 KB Bundle, echter Compiler, 10 Läufe: Median 115,31 ms,
  p95 144,87 ms; seriell, maximal 200 Einträge und 2 MiB.
- Verwaltung von 250 Erweiterungen, Seitenableitung: Median 0,004 ms,
  p95 0,014 ms, maximal 25 Referenzen pro Seite, keine Hintergrundarbeit.
- Zwei repräsentative Verwaltungsseiten: Median 10,80 ms, p95 60,47 ms,
  maximal 601 HTML-Elemente pro Seite.
- 30 Plugins, 117950 Quellbytes: Kaltladen Median 84,63 ms/p95 92,10 ms;
  unverändertes Laden Median 0,428 ms/p95 0,482 ms (<2 ms);
  ein geändertes Plugin Median 2,55 ms/p95 6,23 ms.
- 48000 Grid-Zellen: Median 34,25 ms/p95 35,46 ms; 480 sichtbare Zellen
  Median 0,412 ms/p95 0,459 ms.
- Retained State: 20 Selektionen, 1000 gerenderte von 400000 angebotenen
  Board-Einträgen, 1640 zusätzliche Heap-Bytes im Szenario, keine Idle-Aufrufe
  während 600 ms.

Gedrosselte und Browser-Performance-Suites nicht ausgeführt; perf-bundle
ist ohne Browser-Opt-in übersprungen. beforeunload ergänzt pagehide;
echtes Tauri-Beenden und abgebrochene Schließvorgänge wurden nicht manuell
auf jeder Plattform geprüft. UI-Verdrahtung für Dialog, Banner, Archiv-Skip,
Badge und Proposal-Cache ist durch Strukturregressionen abgedeckt.

## Checks

- 140 Bun-Tests unter 1.3.10 erfolgreich, in elf isolierten Prozessen.
- Typecheck erfolgreich; Biome erfolgreich mit bestehender Warnung
  noConfusingVoidType in extension-manager-base.ts.
- cargo check erfolgreich (bestehende Vendor-Warnungen).
- MCP-Modul: 22 erfolgreich, ein bestehender Fehler:
  published_tools_are_annotated_slim_and_keep_array_items erwartet einen
  Annotationstitel für ui_plugins. Nicht durch diese Fixes verursacht;
  gemäß AGENTS.md nicht mitgeändert.
- Proposal-Modul: drei Tests erfolgreich, einschließlich idempotenter
  Wiederholung, Event-Antworten, zwei parallelen Vorschlägen, Timeout,
  Cancellation und Kapazitätsgrenze. 30 × 256 KiB, Median 85,69 ms,
  p95 124,05 ms bei 5-ms-Timeout und Grenze p95 <250 ms, Queue <=8.
- Push-Hook durch fremdes TS6133 in src/lib/versioning/ledger.ts:346
  blockiert. Sauberer git-archive-Export wird vor dem autorisierten
  --no-verify-Push separat geprüft.
- Sauberer Export von 0f2ec23d: Typecheck, Biome, cargo fmt --check und
  cargo check erfolgreich. Daher --no-verify für den Push autorisiert.
