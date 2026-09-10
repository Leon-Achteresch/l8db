# L8DB-PLAN-019: Abfrageergebnisse lokal filtern

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Ergebnisse
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Treffer im bereits geladenen Resultat eingrenzen. Der Tabellenbrowser besitzt Filter, die separate Ergebnistabelle nicht.

## Umfang

Spaltenfilter für Gleichheit, Text enthält und NULL in QueryResultTable.

## Akzeptanzkriterien

- [ ] Filter kombinieren sich mit UND und lassen sich vollständig zurücksetzen.
- [ ] Trefferzahl und Gesamtzahl der geladenen Zeilen bleiben sichtbar.
- [ ] Filtern führt weder SQL aus noch ändert es die Daten.

**Nicht enthalten:** Vollständige serverseitige Ergebnisfilterung.

**Abhängigkeiten:** [L8DB-PLAN-018](L8DB-PLAN-018-ergebnisse-sortieren.md)

**Code-Anknüpfung:** [src/features/query/query-result-table.tsx](../../../src/features/query/query-result-table.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0286](../../toad-for-oracle-feature-audit.de.md#g25) (Clientseitige Ergebnisfilter; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
