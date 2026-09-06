# L8DB-PLAN-016: Lesezeichen in SQL-Tabs setzen

Typ: Story · Priorität: **P3** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Wichtige Stellen langer Skripte schnell anspringen. Keine l8db-Lesezeichenverwaltung im Query-Editor gefunden.

## Umfang

Zeilenmarkierung, nächstes/vorheriges Lesezeichen und Speicherung je Query-Tab.

## Akzeptanzkriterien

- [ ] Markierungen lassen sich per Tastatur setzen und entfernen.
- [ ] Einfügen von Zeilen verschiebt Markierungen mit dem Inhalt.
- [ ] Lesezeichen werden beim Wiederherstellen des Tabs geladen.

**Nicht enthalten:** Debugger-Haltepunkte.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0043](../../toad-for-oracle-feature-audit.de.md#g06) (Lesezeichen setzen und anspringen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
