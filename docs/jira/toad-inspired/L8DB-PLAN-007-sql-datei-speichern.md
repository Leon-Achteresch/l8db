# L8DB-PLAN-007: Query-Tabs als SQL-Datei speichern

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Skripte in einem Git-Arbeitsverzeichnis weiterverwenden. SQL liegt in persistierten Tabs beziehungsweise gespeicherten Abfragen; Ergebnisexport ist bereits vorhanden.

## Umfang

Speichern und Speichern unter für Query-Text mit Änderungsanzeige.

## Akzeptanzkriterien

- [ ] Ein neuer Tab fragt nach dem Pfad; ein dateigebundener Tab speichert an denselben Pfad.
- [ ] Nach erfolgreichem Schreiben verschwindet die Änderungsmarkierung.
- [ ] Abbruch und Schreibfehler lassen Text und Änderungsstatus erhalten.

**Nicht enthalten:** Git-Commit oder Synchronisierung.

**Abhängigkeiten:** [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md)

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0037](../../toad-for-oracle-feature-audit.de.md#g06) (Dateien speichern; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
