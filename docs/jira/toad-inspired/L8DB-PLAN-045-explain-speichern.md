# L8DB-PLAN-045: Ausführungsplan mit Kontext speichern

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Explain
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Performance-Untersuchungen reproduzierbar dokumentieren. EXPLAIN und ANALYZE werden als Baum dargestellt, aber nicht als Planartefakt gespeichert.

## Umfang

Den bereits geladenen PostgreSQL-Plan als versionierte JSON-Datei speichern.

## Akzeptanzkriterien

- [ ] Plan, SQL, Analyze-Flag und Erfassungszeit sind enthalten.
- [ ] Vor Export wird deutlich, dass SQL und Plan Literale enthalten können.
- [ ] Speichern führt die Abfrage nicht erneut aus und enthält keine Zugangsdaten.

**Nicht enthalten:** Automatische Planhistorie und Hintergrundmessungen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/explain-plan-view.tsx](../../../src/features/query/explain-plan-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0821](../../toad-for-oracle-feature-audit.de.md#g75) (Explain Plan speichern; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
