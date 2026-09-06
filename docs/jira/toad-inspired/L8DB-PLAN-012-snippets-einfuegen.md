# L8DB-PLAN-012: SQL-Snippets mit Platzhaltern einfügen

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Parameter in wiederkehrenden Bausteinen schnell ausfüllen. Completion bietet Tabellen und Spalten, aber keine nutzerdefinierten Vorlagen.

## Umfang

Snippets aus Ticket 011 über Completion einfügen; Monaco-Tabstops verwenden.

## Akzeptanzkriterien

- [ ] Kürzel erscheinen neben vorhandenen Vorschlägen.
- [ ] Mehrzeiliger Text und Tabstop-Reihenfolge werden korrekt übernommen.
- [ ] Einfügen ist mit einer Undo-Aktion rückgängig und führt nichts aus.

**Nicht enthalten:** Makros und SQL-Parameterbindung.

**Abhängigkeiten:** [L8DB-PLAN-011](L8DB-PLAN-011-snippets-verwalten.md)

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0068](../../toad-for-oracle-feature-audit.de.md#g08) (Vorlagen über Kürzel auswählen; D26); [TOAD-0069](../../toad-for-oracle-feature-audit.de.md#g08) (Mehrzeilige Vorlagen; D26); [TOAD-0070](../../toad-for-oracle-feature-audit.de.md#g08) (Substitutionsvariablen in Vorlagen; D26); [TOAD-0071](../../toad-for-oracle-feature-audit.de.md#g08) (Cursorposition in Vorlagen vorgeben; D26); [TOAD-0072](../../toad-for-oracle-feature-audit.de.md#g08) (Vorlagen über Ctrl+Space einfügen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
