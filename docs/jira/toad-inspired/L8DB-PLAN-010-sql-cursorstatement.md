# L8DB-PLAN-010: PostgreSQL-Statement unter dem Cursor ausführen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

In längeren Skripten ohne manuelle Textauswahl arbeiten. Der Editor hat keinen abgegrenzten Cursor-Statement-Befehl.

## Umfang

Statement-Grenzen zunächst für PostgreSQL erkennen und das betroffene Statement ausführen.

## Akzeptanzkriterien

- [ ] Semikolons in Strings, Kommentaren und Dollar-Quotes trennen nicht fälschlich.
- [ ] Das erkannte Statement wird vor oder bei Ausführung hervorgehoben.
- [ ] Bei unklarer Grenze erfolgt keine automatische Ausführung; eine manuelle Auswahl bleibt möglich.

**Nicht enthalten:** PL/SQL-Parser und alle SQL-Dialekte.

**Abhängigkeiten:** [L8DB-PLAN-009](L8DB-PLAN-009-sql-auswahl-ausfuehren.md)

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0095](../../toad-for-oracle-feature-audit.de.md#g11) (Einzelnes Statement ausführen; D26); [TOAD-0086](../../toad-for-oracle-feature-audit.de.md#g10) (Statements hervorheben; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
