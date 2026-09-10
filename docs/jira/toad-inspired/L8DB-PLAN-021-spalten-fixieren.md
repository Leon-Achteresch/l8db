# L8DB-PLAN-021: Beliebige Datenspalten links fixieren

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Grid
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Schlüssel beim horizontalen Scrollen im Blick behalten. Nur die Zeilennummer ist fest positioniert; Spaltenreihenfolge und Sichtbarkeit sind bereits gespeichert.

## Umfang

Fixieren und Lösen über Spaltenmenü; Zustand pro Tabelle speichern.

## Akzeptanzkriterien

- [ ] Mehrere fixierte Spalten bleiben in ihrer Reihenfolge links sichtbar.
- [ ] Horizontales Scrollen und Größenänderung erzeugen keine Überlagerungen.
- [ ] Gelöschte Spalten werden aus der gespeicherten Fixierung entfernt.

**Nicht enthalten:** Gruppierungszeilen und Excel-Freeze-Panes.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0278](../../toad-for-oracle-feature-audit.de.md#g25) (Spalten fixieren; D26); [TOAD-0279](../../toad-for-oracle-feature-audit.de.md#g25) (Fixierung aufheben; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
