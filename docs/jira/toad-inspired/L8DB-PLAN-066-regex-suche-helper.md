# L8DB-PLAN-066: Regex-Suche mit Helper

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Monaco deckt einfache Suche ab; reguläre Ausdrücke und eine Pattern-Hilfe fehlen in Editor, Grid- und Quelltextsuche.

## Umfang

Regex-Schalter in der Editorsuche plus Helper-Panel mit gängigen Mustern, Live-Trefferzählung und Escape-Hilfe. Schalter auch für Grid-Textsuche und Routinen-Quelltextsuche vorsehen.

## Akzeptanzkriterien

- [ ] Regex-Modus ist umschaltbar; ungültige Patterns melden die Fehlerstelle.
- [ ] Helper bietet einsetzbare Muster und zeigt die Trefferanzahl live.
- [ ] Einstellung pro Suche merken, ohne andere Suchmodi zu verändern.

**Nicht enthalten:** Such-/Ersetzungs-Makros und parallele Dateisuche.

**Abhängigkeiten:** [L8DB-PLAN-020](L8DB-PLAN-020-grid-textsuche.md), [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) als Mitnutzer des Schalters.

**Code-Anknüpfung:** [src/lib/monaco.ts](../../../src/lib/monaco.ts), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx)

**Toad-Bezug:** [TOAD-0052](../../toad-for-oracle-feature-audit.de.md#g07) (Reguläre Ausdrücke; D26); [TOAD-0059](../../toad-for-oracle-feature-audit.de.md#g07) (Escape-Sequenzen beim Ersetzen interpretieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
