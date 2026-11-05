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
