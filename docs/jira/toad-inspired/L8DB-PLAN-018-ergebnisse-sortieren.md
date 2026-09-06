# L8DB-PLAN-018: Abfrageergebnisse lokal sortieren

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Ergebnisse
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Ein Ergebnis ohne erneute SQL-Ausführung untersuchen. QueryResultTable ist eine einfache Tabelle ohne Sortierinteraktion; der Tabellenbrowser kann bereits sortieren.

## Umfang

Ein- und mehrspaltige Sortierung ausschließlich der geladenen Ergebniszeilen.

## Akzeptanzkriterien

- [ ] Aufsteigend, absteigend und zurücksetzen sind möglich.
- [ ] NULL und gemischte Werte erhalten eine definierte stabile Reihenfolge.
- [ ] Die UI kennzeichnet die Sortierung als lokal; es wird keine neue Query gesendet.

**Nicht enthalten:** Serverseitiges Umschreiben beliebigen SQLs.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-result-table.tsx](../../../src/features/query/query-result-table.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0282](../../toad-for-oracle-feature-audit.de.md#g25) (Daten sortieren; D26); [TOAD-0418](../../toad-for-oracle-feature-audit.de.md#g37) (Mehrspaltige Gridsortierung; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
