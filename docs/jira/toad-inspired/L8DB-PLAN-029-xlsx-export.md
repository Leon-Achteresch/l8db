# L8DB-PLAN-029: Geladene Ergebnisse als XLSX exportieren

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Ergebnisse ohne manuellen CSV-Import an Fachanwender weitergeben. CSV und JSON sind vorhanden, XLSX fehlt.

## Umfang

Geladene Tabellen- und Query-Ergebnisse als XLSX mit wählbarem Blattnamen.

## Akzeptanzkriterien

- [ ] Header und Spaltenreihenfolge entsprechen der Exportauswahl.
- [ ] Lange IDs bleiben exakt; Text mit Formelpräfix bleibt Text.
- [ ] Ungültige Blattnamen und Excel-Größenlimits führen zu verständlichen Hinweisen.

**Nicht enthalten:** XLS, laufende Excel-Instanzen und ausführbare Formeln.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0408](../../toad-for-oracle-feature-audit.de.md#g34) (XLSX-Export; H); [TOAD-0410](../../toad-for-oracle-feature-audit.de.md#g36) (Excel-Arbeitsblattnamen vorgeben; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
