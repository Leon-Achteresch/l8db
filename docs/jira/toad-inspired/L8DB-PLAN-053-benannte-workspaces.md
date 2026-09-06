# L8DB-PLAN-053: Benannte Arbeitsplatzstände speichern und öffnen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Workspace
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Zwischen mehreren Arbeitsaufgaben derselben Verbindung wechseln. Tabs und Split-Panes werden bereits automatisch pro Verbindung persistiert.

## Umfang

Benannte lokale Snapshots von Tabs, Query-Text und Pane-Anordnung.

## Akzeptanzkriterien

- [ ] Speichern, Öffnen und Löschen sind möglich.
- [ ] Öffnen behandelt aktuelle Query-Änderungen ausdrücklich und führt kein SQL aus.
- [ ] Fehlende Objekte oder Profile werden gemeldet; Ergebnisse und Transaktionen werden nicht wiederhergestellt.

**Nicht enthalten:** Grundlegende Tab-Wiederherstellung neu bauen, Cloud-Sync und Dateiimport.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts), [src/lib/split-view.ts](../../../src/lib/split-view.ts), [src/lib/workspace-pane.ts](../../../src/lib/workspace-pane.ts)

**Toad-Bezug:** [TOAD-0825](../../toad-for-oracle-feature-audit.de.md#g75) (Eigene Workspaces erstellen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
