# L8DB-PLAN-031: Gefilterte PostgreSQL-Tabelle vollständig exportieren

Typ: Story · Priorität: **P2** · Schätzung: **5 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Auch mehr als die aktuelle Seite zuverlässig exportieren. Der aktuelle Tabellenexport verwendet die bereits geladenen Zeilen.

## Umfang

Expliziter Export aller gefilterten Zeilen einer PostgreSQL-Tabelle als gestreamte CSV-Datei.

## Akzeptanzkriterien

- [ ] Ein konsistenter Datenbanksnapshot, Filter und stabile Sortierung bestimmen den Export.
- [ ] Fortschritt und Abbruch sind vorhanden; Speicherverbrauch wächst nicht linear mit der Tabelle.
- [ ] Abbruch oder Fehler kennzeichnen beziehungsweise entfernen die unvollständige Datei; Erfolg zeigt die exportierte Zeilenzahl.

**Nicht enthalten:** Unbegrenzte Query-Exporte, mehrere Provider und parallele Exportjobs.

**Abhängigkeiten:** [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md)

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0386](../../toad-for-oracle-feature-audit.de.md#g32) (Export aus Schema Browser; H); [TOAD-0416](../../toad-for-oracle-feature-audit.de.md#g37) (Exportabfrage ohne Grid-Anzeige abbrechen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
