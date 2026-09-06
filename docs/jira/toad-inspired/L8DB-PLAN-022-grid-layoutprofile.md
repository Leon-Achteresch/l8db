# L8DB-PLAN-022: Benannte Tabellenlayouts speichern

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Zwischen Analyseansichten derselben Tabelle wechseln. Eine Spaltenreihenfolge und Sichtbarkeit pro Tabelle werden bereits persistiert.

## Umfang

Benannte Profile für Reihenfolge, Breiten, Sichtbarkeit und Fixierung.

## Akzeptanzkriterien

- [ ] Profile lassen sich speichern, anwenden, umbenennen und löschen.
- [ ] Schlüssel enthält Verbindung, Datenbank, Schema und Tabelle.
- [ ] Neue oder entfernte Spalten werden beim Anwenden verträglich behandelt.

**Nicht enthalten:** Daten, Filter und komplette Workspaces im Layoutprofil.

**Abhängigkeiten:** [L8DB-PLAN-021](L8DB-PLAN-021-spalten-fixieren.md)

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0672](../../toad-for-oracle-feature-audit.de.md#g65) (Grid-Layouts speichern; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
