# L8DB-PLAN-032: CSV-Exportoptionen als Vorlage speichern

Typ: Story · Priorität: **P3** · Schätzung: **2 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Regelmäßige Exporte einheitlich konfigurieren. Exportparameter besitzen keine wiederverwendbaren benannten Vorlagen.

## Umfang

Benannte lokale Vorlagen für die Optionen aus Ticket 030; Toad-Parameterkonzept wird auf CSV übertragen.

## Akzeptanzkriterien

- [ ] Vorlagen lassen sich speichern, anwenden und löschen.
- [ ] Die Vorschau aktualisiert sich nach Vorlagenwahl.
- [ ] Vorlagen enthalten keine Zeilendaten oder Zugangsdaten.

**Nicht enthalten:** Data Pump, Zeitplanung und automatische Exportausführung.

**Abhängigkeiten:** [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md)

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0399](../../toad-for-oracle-feature-audit.de.md#g32) (Data-Pump-Parameter konfigurieren; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
