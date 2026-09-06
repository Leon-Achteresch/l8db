# L8DB-PLAN-041: SQL vor dem Erstellen einer PostgreSQL-Tabelle anzeigen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: DDL
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Die tatsächlich geplante Struktur vor Ausführung prüfen. CreateTableView sendet das Formular direkt an createTable.

## Umfang

Eine SQL-Vorschau aus derselben Backend-Generierung wie die spätere Ausführung bereitstellen.

## Akzeptanzkriterien

- [ ] Formularänderungen aktualisieren die Vorschau.
- [ ] Das bestätigte SQL entspricht genau dem ausgeführten SQL.
- [ ] Kopieren ist möglich und erzeugt keine Tabelle; Ausführung verwendet die bestehende Fehlerbehandlung.

**Nicht enthalten:** Freies Bearbeiten der Vorschau und alle DDL-Dialoge.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/tables/create-table-view.tsx](../../../src/features/tables/create-table-view.tsx), [src/features/alter-table/alter-table-view.tsx](../../../src/features/alter-table/alter-table-view.tsx), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0226](../../toad-for-oracle-feature-audit.de.md#g22) (DDL vor Ausführung anzeigen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
