# L8DB-PLAN-059: SQL-Skript aus dem Query-Tab mit Einzelergebnissen ausführen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Mehrere Statements bearbeiten und ihren Verlauf an einer Stelle prüfen. SQL-Import nutzt executeScript mit Statement-Ergebnissen; QueryView stellt nur ein Ergebnis dar.

## Umfang

Explizite Skriptaktion im Query-Tab zunächst für PostgreSQL; vorhandenen Runner wiederverwenden.

## Akzeptanzkriterien

- [ ] Ausgabe listet Reihenfolge, Erfolg/Fehler und Dauer pro Statement.
- [ ] Vor Start ist das tatsächliche Commit- und Fehlerverhalten sichtbar; offene Nutzertransaktionen verhindern einen zweiten unabhängigen Ablauf.
- [ ] Fehlgeschlagene Statements können im Editor lokalisiert werden; kein Ergebnis wird stillschweigend verschluckt.

**Nicht enthalten:** Automatisierung, parallele Ausführung und PL/SQL-Debugger.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0096](../../toad-for-oracle-feature-audit.de.md#g11) (Skript im Editor ausführen; D26); [TOAD-0155](../../toad-for-oracle-feature-audit.de.md#g15) (Skript-Ausgabe untersuchen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
