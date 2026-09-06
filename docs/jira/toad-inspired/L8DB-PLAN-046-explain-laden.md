# L8DB-PLAN-046: Gespeicherten PostgreSQL-Plan offline öffnen

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Explain
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Einen gespeicherten Plan ohne Datenbankverbindung untersuchen. Die Planansicht ist an das aktuelle Query-Ergebnis gebunden.

## Umfang

Das Format aus Ticket 045 validieren und in der vorhandenen Baumansicht öffnen.

## Akzeptanzkriterien

- [ ] Öffnen funktioniert ohne aktive Verbindung und führt kein SQL aus.
- [ ] Unbekannte Dateiversionen und ungültige Pläne erzeugen eine klare Fehlermeldung.
- [ ] Geschätzter Plan und Analyze-Plan sind sichtbar unterschieden.

**Nicht enthalten:** Import aller Hersteller-Planformate.

**Abhängigkeiten:** [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md)

**Code-Anknüpfung:** [src/features/query/explain-plan-view.tsx](../../../src/features/query/explain-plan-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0821](../../toad-for-oracle-feature-audit.de.md#g75) (Explain Plan speichern; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
