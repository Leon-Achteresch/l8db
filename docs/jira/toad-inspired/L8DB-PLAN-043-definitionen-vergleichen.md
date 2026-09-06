# L8DB-PLAN-043: Zwei Objektdefinitionen nebeneinander vergleichen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Unterschiede zwischen Entwicklungs- und Zielstand erkennen. View- und Funktionsdefinitionen sind lesbar; eine Diff-Ansicht fehlt.

## Umfang

Zwei PostgreSQL-View- oder Routinen-Definitionen in einem schreibgeschützten Text-Diff anzeigen.

## Akzeptanzkriterien

- [ ] Quelle und Ziel zeigen Verbindung, Datenbank und Objektidentität.
- [ ] Geänderte Zeilen und nächste/vorherige Änderung sind navigierbar.
- [ ] Ladefehler behalten ihre Seitenzuordnung; keine Definition wird geändert.

**Nicht enthalten:** Automatische Migration, Merge und DDL aller Objekttypen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0342](../../toad-for-oracle-feature-audit.de.md#g30) (Einzelne Schemaobjekte vergleichen; D26); [TOAD-0347](../../toad-for-oracle-feature-audit.de.md#g30) (DDL nebeneinander vergleichen; D26); [TOAD-0184](../../toad-for-oracle-feature-audit.de.md#g18) (Zwei Quellansichten nebeneinander; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
