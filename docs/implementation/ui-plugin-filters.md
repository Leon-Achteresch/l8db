# UI-Plugin-Filter: Implementierungsstand

Umgesetzt ist die API-Grundlage für Tabellenaktionen:

- `ctx.setFilter({column, operator, value?})` verwendet `compileSingleCondition`, prüft Spalten und `sql_filter`, ergänzt bestehende einfache Filter mit AND und setzt die Seite zurück.
- `ctx.clearFilter()` löscht den gesamten Tabellenfilter.
- `await ctx.pickColumn()` verwendet den bestehenden Erweiterungs-QuickPick; Abbruch ergibt `null`.
- `placement: "beforeFilter"` platziert eine Aktion in der Datenansicht links vor dem Filter. Standard bleibt die Toolbar.
- Der Filter ist auf 65.536 Zeichen begrenzt. SQL-Modus mit Raw-Filter wird abgelehnt. Serverseitige Validierung bleibt unverändert.

Beispiel:

```ts
import { definePlugin } from "@l8db/ui";
export default definePlugin({
  id: "null-filter",
  slots: {
    table: {
      toolbar: () => [{
        id: "nulls", label: "NULL filtern", placement: "beforeFilter",
        async run(ctx) {
          const column = await ctx.pickColumn();
          if (column !== null) ctx.setFilter({ column, operator: "isNull" });
        },
      }],
    },
  },
});
```

## Prüfung

148 gezielte Bun-Tests (Filter, bestehende Runtime und Compiler) bestanden.
Filter-Messung: 10.000 Spalten, 1.000 Aufrufe, Median 0,037 ms, p95 0,099 ms;
p95-Budget 20 ms. Der Dienst erzeugt keine direkten DB-Anfragen; die normale
Tabellenreaktion auf einen geänderten Filter wurde damit nicht gemessen.
Der bestehende Store begrenzt gespeicherte Tabellenzustände auf 100 Einträge.

Plattform: macOS 27.0.1, arm64, Apple M3, 16 GiB RAM, Bun 1.4.3.
Die installierte Bun-Version weicht von der geforderten 1.3.10 ab.
Keine CPU-Drosselung, kein Nachweis für andere Plattformen oder echte Datenbankfamilien.

## Noch offen

KI-Werkzeug für Chat/MCP, Code-/Diff-Freigabe vor Aktivierung, Status-Wartepfad,
Export/Import und Vereinheitlichung mit Extensions sind nicht implementiert.
Die Isolation der Extension-Laufzeit ist noch nicht abschließend bewertet.
Für diese offenen Schritte gibt es keine neuen Sicherheits-, Import- oder Performance-Tests.
Mehrfenstersynchronisation des bestehenden Tabellenzustands wurde nicht geändert oder getestet.
Echte App-E2E samt Screenshots wurde nicht durchgeführt. Es gibt keine Screenshot-Artefakte.

## Laufzeitschutz (Schritt A, 2026-11-05)

- `packages/ui-plugin-api/src/instrument.ts`: Acorn instrumentiert nach dem Sucrase-Transform
  jede Schleife (`check`) und jede Funktion (`enter`/`leave` mit `try/finally`). Ein eingefrorener
  Wächter je Plugin begrenzt einen Aufruf auf 100 ms und 256 Ebenen; nach dem ersten Abbruch
  bleibt er gesperrt, auch wenn Plugin-Code den Fehler fängt. `SlotGuard` schaltet den Slot sofort ab.
- `await X` wird zu `await guard.suspend(X)`: Die Tiefe wird beim Aussetzen abgegeben und beim
  Fortsetzen (Erfolg und Ablehnung) neu angesetzt. Ohne das brach jeder Aufruf ab, solange eine
  `async`-Funktion des Plugins wartete (reproduziert, Test vorhanden).
- Generatoren und `for await` werden beim Übersetzen abgelehnt.
- Pfeilfunktionen mit Ausdrucksrumpf ohne Aufruf (`(v) => v * 2`) bleiben ohne Wächter: ohne
  Aufruf, `new` oder Tagged Template können sie weder schleifen noch rekursiv laufen.
- Regex mit quantifizierten Gruppen und `RegExp` mit nicht-literalem Muster werden abgelehnt;
  `repeat`/`Array` erhalten eine Argumentgrenze von 1.000.000.
- Abgesicherter Modus (`src/lib/ui-plugins/safe-mode.ts`): Je Fenster ein Merker in
  `localStorage` vor dem ersten Laden, gelöscht nach 10 s oder beim Schließen. Ist beim Start
  der eigene Merker noch da oder der eines anderen Fensters älter als 60 s, starten die Plugins
  aus, mit Toast und „Wieder aktivieren“ in Einstellungen → Erweiterungen (wirkt per
  `storage`-Event in allen Fenstern).

Restrisiko: Native Aufrufe, die lange laufen, ohne Plugin-Code zurückzurufen (z. B.
`Array.from({ length: 1e9 })`, `padEnd(1e9)`, Aliase auf `repeat`), kann der Wächter nicht
unterbrechen. Dagegen bleibt nur der abgesicherte Modus beim nächsten Start. Hänger, die erst
später als 10 s nach dem Start auftreten, erkennt er nicht.

Messung (macOS 27.0.1 arm64, Apple M3, 16 GiB, Bun 1.4.3, Rechner unter Last 5–9, keine Drossel),
`tests/perf-ui-plugins.test.ts`, 30 Plugins/117.950 Bytes, je Lauf abwechselnd ohne/mit Wächter:

| | Kaltladen median | Kaltladen p95 |
|---|---|---|
| ohne Wächter | 72–80 ms | 92–105 ms |
| mit Wächter | 93–125 ms | 110–238 ms |

Grid 48.000 Zellen: p95 0,70–0,86 µs/Zelle; sichtbares Fenster p95 0,36–0,48 ms (Budget 3 ms).
Das 150-ms-Budget für das Kaltladen hält bei ruhigem Rechner. Unter der Last parallel
laufender Agenten verfehlen einzelne Läufe es, auch ohne Wächter (einmal 161 ms). Das p95 aus
5 Läufen ist dabei der langsamste Lauf. Das Budget ist unverändert.

## KI-/MCP-Vorschläge (2026-11-05)

`ui_plugins` ist im gemeinsamen Werkzeugkatalog und im App-Chat verfügbar. Aktionen:
`api`, `list`, `read`, `status`, `write`, `remove`. `api` liefert die SDK-Typen und
Ordneranleitung. Werkzeugbeschreibung und bestehender KI-Kontext behandeln
Tabellendaten und Beschreibungen als Daten, niemals als Anweisungen.

Änderungen landen unter `~/.l8db/ui/.proposals/` in acht atomar reservierten Slots.
Die Queue nutzt Dateisystem-Benachrichtigungen, keine Intervallabfragen. Ein wartender
Future hält genau einen Slot; Drop bei Abbruch, Timeout oder Antwort räumt ihn auf.
Nach einem Prozessabsturz werden verwaiste Slots nach 130 Sekunden bei Wiederverwendung
entfernt. Ohne geöffnetes Hauptfenster läuft der Vorschlag nach 120 Sekunden ab.
MCP-stdio nimmt während eines laufenden Werkzeugs Abbruchmeldungen entgegen; weitere
RPC-Anfragen erhalten währenddessen einen Busy-Fehler. Der Eingabekanal hat acht Plätze.

Nur das Fenster `main` darf Vorschläge lesen/entscheiden (auch im Backend geprüft).
Der Dialog validiert mit `checkUiPluginSource`, zeigt Code, bei Überschreiben den Diff
und angeforderte HTTP-Ziele. Compilerfehler werden ohne Änderung der Plugin-Datei
zurückgemeldet. Keine Auto-Approve-Option, keine neuen HTTP-Grants. Bestehende Grants
bleiben unverändert. Auch Galerie-/Fremdplugins brauchen Bestätigung. Vor Anwendung
wird der alte Inhalt verglichen; parallele Änderungen werden nicht überschrieben.
Nichtreguläre Dateien und Dateien über 256 KiB werden nicht als Vorlage gelesen.

Nach Übernahme lädt der Host erneut. Der Status wartet über eine Store-Subscription
auf 250 ms Ruhe, höchstens zwei Sekunden; die Antwort enthält Hoststatus, Zeile,
`slotErrors`, `tripped` und Laufzeitfehler. Später auftretende Fehler bleiben über
`status` abrufbar. Plugin-Quelltext wird im Dialog als React-Text gerendert.

Validierung: Bun-Vorschlagstests (NULL-Aktion mit Spaltenwahl, passiver Injection-Text,
Compilerfehler mit Zeile, großer Diff); bestehende Filter-, Execution-, Safe-Mode-
und 49 Host-/Runtime-Tests (u. a. stale, Slotfehler, tripped, HTTP-Grants).
Rust-Tests prüfen Queue-Antworten, zwei Vorschläge, Ablehnung, Timeout ohne App,
Abbruch-Cleanup, Kapazität sowie atomare Übernahme/Entfernung und Pfadnamen.
Keine native Mehrfenster-/Dialog-E2E ausgeführt; die Fensterprüfung ist Code-seitig
abgesichert. Keine Aussage über reale Windows-/Linux-Systeme oder Datenbankfamilien.

Performance: macOS 27.0.1 arm64, Apple M3, 16 GiB RAM, Rust 1.99.0, Bun 1.3.10.
30 Diffs mit 25.000 alten + 25.000 neuen Zeilen: median 6,91 ms, p95 9,49 ms
(Budget p95 <100 ms, Diff-Matrix auf 100.000 Zellen begrenzt).
Queue mit 256-KiB-Vorschlägen, 30 Läufe, 5-ms-Testtimeout inklusive atomarem Schreiben,
Dateisystem-Watcher und Cleanup: erster Lauf median 78,07 ms, p95 127,18 ms
(Budget p95 <250 ms; parallel laufende Builds). Maximal acht Slots; zwei Quelltexte
je Slot (neu/bisher), jeweils höchstens 256 KiB, zuzüglich begrenzter JSON-Escapes.
Keine Datenbankanfragen; Idle wartet auf Events, Abbruch löscht alle reservierten Slots.
Keine CPU-Drosseltests auf macOS.

Prüfstand beim ersten Commit: Die zwei Queue-/Perf-Tests liefen erfolgreich. Nach
Ergänzen der Snapshot-/Overwrite-Prüfung blockierten fremde Transfer-Änderungen die
Test-Kompilierung (`transfer_tests.rs:519,970`: entferntes `create_schemas`). Der erste
`cargo check` war erfolgreich; ein späterer Lauf traf den parallelen Umbau
(`automation/steps/data.rs`: fehlendes `mirror`). Typecheck und Pre-Push wurden durch
fehlende `transfer-cinematic-variant(s)` in `transfer-cinematic-lab.tsx` blockiert.
Diese fremden Dateien wurden nicht geändert. Biome auf eigenen TS-Dateien ist grün.
Die drei Vorschlagstests bestehen mit Bun 1.3.10; 28 Filter-/Execution-/Safe-Mode-Tests
bestanden im initialen Lauf mit dem vorinstallierten Bun 1.4.3, 49 Runtime-Tests mit
Bun 1.3.10. Die erste Diff-Assertion wurde von 50.002 auf 50.000 korrigiert, da der
identische abschließende Leerstring zum gemeinsamen Suffix gehört.

## Schritt C: UI-Plugin-Bundles

Implementiert: Export aller oder ausgewählter Quellen und Optionen über den
Tauri-Speicherdialog; Import mit Dateidialog, Backend-Limit 2 MiB/200 Einträge,
256 KiB je Quelle und bestehenden flachen Namensregeln. JSON-/Versionsfehler
weisen das Bundle ab; einzelne defekte Einträge bleiben abwählbar. Compilerprüfung
vor Vorschau und Übernahme; Code, Diff, Status und aus dem Quelltext ermittelte
HTTP-Hosts je Eintrag. Ohne Bestätigung werden keine Plugin-Dateien geschrieben.
Konflikte werden explizit ausgewählt oder übersprungen; geänderte Vorschau-Snapshots
werden vor dem Schreiben abgewiesen. Schreibvorgänge sind je Datei atomar; ein
Dateisystemfehler kann einen bereits teilweise übernommenen Import hinterlassen.
HTTP-Grants werden weder exportiert noch importiert, für importierte IDs entzogen.
Optionen laufen über den vorhandenen mehrfensterfähigen Settings-Store.

Formatentscheidung für Schritt D: Das volle Extension-Archiv enthält eine einzelne
Manifest-Erweiterung (format: 1, manifest, files). Das UI-Bundle verwendet den
separaten Typ l8db.ui-plugins und version: 1 mit mehreren Einträgen. Beide lassen
sich später eindeutig in einen gemeinsamen Container übernehmen. Keine automatische
Verteilung. Bedienung und Format: docs/ui-plugin-bundles.md; Ordneranleitung ergänzt.

Messung: macOS Darwin arm64, Apple M3, 16 GiB RAM, Bun 1.3.10.
200 Plugins × 8.000 Bytes, 30 Import-/Export-Runden mit Compiler-Stub:
Median 1,06 ms, p95 4,12 ms (Budget p95 <250 ms). Eingabe auf 2 MiB und
200 Einträge begrenzt; Quellenprüfung seriell, keine DB-Anfragen, kein Polling,
keine weiteren Prüferaufrufe nach 20 ms Idle. Dies misst JSON und Vorschauverwaltung,
nicht die komplette Kompilierung oder native Dialoglatenz. Reale Compiler- und
Endlosschleifenprüfungen sind separat funktional getestet. Kein Vorher-Baselinewert,
da neue Funktion; keine CPU-/Heap-Drosselung auf macOS.

Bun 1.3.10: 80 gezielte Bundle-/Runtime-/Execution-/Safe-Mode-Tests und ein separater
Settings-Storage-Event-Test erfolgreich. Biome auf eigenen Dateien erfolgreich.
Ein früher Lauf mit vorinstalliertem Bun 1.4.3 hatte 60 erfolgreiche Tests und
Bundle median/p95 1,59/4,08 ms. Typecheck im gemeinsamen Checkout blockiert durch
fremde entfernte transfer-cinematic-variant(s)-Module. Cargo check erfolgreich;
abschließende Archivprüfung und Rust-Modultests werden im Abschluss ergänzt.
Native Dateidialoge und zwei echte Desktop-Fenster wurden nicht manuell getestet;
Abbruch/Selektion/Snapshot-Konflikte und Storage-Synchronisation sind isoliert getestet.

Zusätzliche Prüfung mit echtem Compiler: 200 Plugins × ca. 8 KiB, zehn Durchläufe,
Median 108,95 ms, p95 270,71 ms; Budget p95 <5.000 ms. Quellenprüfung bleibt seriell,
Prüf-Timer werden verworfen, keine wachsende Compile-Queue. Der Test besteht mit
Bun 1.3.10. Optionen werden pro Plugin in einem Store-Update ersetzt, statt für
jeden Schlüssel erneut localStorage zu schreiben. Keine Heap-Messung: die
Speicherevidenz sind die harten Eingabe-/Eintragsgrenzen und serielle Verarbeitung.
Rust-Modultests: 5 bestanden. TypeScript und Biome im sauberen HEAD-Archiv bestanden.
Archivprüfung des Implementierungscommits: cargo fmt --check und cargo check mit
geteiltem CARGO_TARGET_DIR ebenfalls erfolgreich (3m46s inklusive Neuprüfung
lokaler Vendor-Pfade). Abschließender Typecheck nach dem gebündelten Optionsimport
im gemeinsamen Checkout erfolgreich. Regulärer Push-Hook wird verwendet.
