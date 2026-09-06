# L8DB-PLAN-033: Gewählte Exportspalten maskieren

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Beispieldaten teilen, ohne ausgewählte Originalwerte mitzugeben. CSV-/JSON-Exporte übernehmen Werte unverändert.

## Umfang

Spalten im CSV-/JSON-Export durch festen Text oder NULL ersetzen, ohne die Datenbank zu ändern.

## Akzeptanzkriterien

- [ ] Eine Vorschau zeigt das maskierte Exportergebnis.
- [ ] Die geschriebenen Dateien enthalten in gewählten Spalten keinen Originalwert.
- [ ] Maskierung gilt nur für den Export und verändert weder Grid noch Datenbank.

**Nicht enthalten:** Garantierte Anonymisierung, automatische PII-Erkennung und deterministische Pseudonyme.

**Abhängigkeiten:** [L8DB-PLAN-030](L8DB-PLAN-030-csv-exportoptionen.md)

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0390](../../toad-for-oracle-feature-audit.de.md#g32) (Exportdaten maskieren; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
