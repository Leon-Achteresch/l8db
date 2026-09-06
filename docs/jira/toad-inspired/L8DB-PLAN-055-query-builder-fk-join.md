# L8DB-PLAN-055: Einen Fremdschlüssel-Join zum Query Builder hinzufügen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Query Builder
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Verknüpfte Daten ohne manuelles JOIN-Schreiben analysieren. Fremdschlüsselmetadaten sind für Navigation und ER-Diagramm vorhanden.

## Umfang

Im einfachen Builder eine zweite Tabelle über einen einspaltigen FK mit INNER oder LEFT JOIN hinzufügen.

## Akzeptanzkriterien

- [ ] Die Beziehung wird ausdrücklich ausgewählt; doppelte Beziehungen bleiben unterscheidbar.
- [ ] Aliase verhindern mehrdeutige Spaltennamen.
- [ ] Vorschau und Übergabe in den Editor enthalten die gewählte Join-Art.

**Nicht enthalten:** Freie Join-Graphen, Subqueries und zusammengesetzte Schlüssel.

**Abhängigkeiten:** [L8DB-PLAN-054](L8DB-PLAN-054-query-builder-basics.md)

**Code-Anknüpfung:** [src/features/table/table-filter-panel.tsx](../../../src/features/table/table-filter-panel.tsx), [src/lib/sql-filter.ts](../../../src/lib/sql-filter.ts), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0116](../../toad-for-oracle-feature-audit.de.md#g13) (Joins per Drag-and-drop; D26); [TOAD-0135](../../toad-for-oracle-feature-audit.de.md#g13) (Outer-Join-Einstellungen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
