# L8DB-PLAN-025: Große Text- und JSON-Werte im Popup bearbeiten

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Mehrzeilige und strukturierte Inhalte zuverlässig ändern. Ein Popup zeigt große Werte bereits an, bietet aber keine vollständige Bearbeitung.

## Umfang

Popup um Bearbeitung für PostgreSQL-Spalten text, json und jsonb erweitern.

## Akzeptanzkriterien

- [ ] JSON wird vor Übernahme validiert; ungültiger Text bleibt bearbeitbar.
- [ ] NULL, leerer String und unveränderter Wert werden unterschieden.
- [ ] Übernehmen verwendet die bestehende Zeilen-/Transaktionslogik; Abbrechen schreibt nichts.

**Nicht enthalten:** BLOB-Dateiimport und beliebige editierbare SELECT-Ergebnisse.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0298](../../toad-for-oracle-feature-audit.de.md#g26) (Große Zellwerte im Popup-Editor; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
