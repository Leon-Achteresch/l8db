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
