# L8DB-PLAN-008: Extern geänderte SQL-Dateien erkennen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Editor
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Änderungen durch IDE oder Git nicht versehentlich überschreiben. Query-Tabs sind bisher keine überwachten Dateidokumente.

## Umfang

Dateigebundene Tabs bei App-Fokus und vor dem Speichern auf externe Änderungen prüfen.

## Akzeptanzkriterien

- [ ] Eine externe Änderung wird am betroffenen Tab sichtbar.
- [ ] Neu laden oder lokale Fassung behalten sind explizite Aktionen.
- [ ] Bei lokalen Änderungen erfolgt kein stiller Reload oder Überschreibvorgang.

**Nicht enthalten:** Drei-Wege-Merge und Hintergrundüberwachung ganzer Ordner.

**Abhängigkeiten:** [L8DB-PLAN-006](L8DB-PLAN-006-sql-datei-oeffnen.md), [L8DB-PLAN-007](L8DB-PLAN-007-sql-datei-speichern.md)

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0675](../../toad-for-oracle-feature-audit.de.md#g65) (Dateiänderungen außerhalb Toad kennzeichnen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
