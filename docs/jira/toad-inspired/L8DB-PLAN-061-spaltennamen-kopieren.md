# L8DB-PLAN-061: Sichtbare Spaltennamen kopieren

Typ: Story · Priorität: **P2** · Schätzung: **1 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

SELECT-Listen ohne Abtippen erstellen. Einzelne Zellwerte sind kopierbar; eine Aktion für die sichtbare Spaltenliste fehlt.

## Umfang

Spaltenmenü-Aktion kopiert sichtbare Namen in aktueller Reihenfolge als Textliste.

## Akzeptanzkriterien

- [ ] Ausgeblendete Spalten und interne Zeilennummern fehlen.
- [ ] Reihenfolge entspricht dem Grid.
- [ ] Leere Ergebnisse mit bekannten Spalten unterstützen die Aktion ebenfalls.

**Nicht enthalten:** SQL-Literale, Datensätze und automatische Identifier-Quoting-Regeln aller Provider.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0291](../../toad-for-oracle-feature-audit.de.md#g25) (Spaltennamen kopieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
