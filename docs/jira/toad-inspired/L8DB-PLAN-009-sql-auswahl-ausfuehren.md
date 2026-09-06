# L8DB-PLAN-009: Nur markiertes SQL ausführen

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Einzelne Teile eines Skripts gezielt prüfen. handleRun verarbeitet aktuell den gesamten SQL-Text des Tabs.

## Umfang

Eigene Aktion für die Monaco-Auswahl über den bestehenden Ausführungspfad.

## Akzeptanzkriterien

- [ ] Nur der ausgewählte Text wird ausgeführt und im Verlauf erfasst.
- [ ] Ohne Auswahl ist die Aktion deaktiviert und führt nicht das gesamte Skript aus.
- [ ] Verbindung, Datenbank und Transaktionsverhalten entsprechen der normalen Ausführung.

**Nicht enthalten:** Automatische Erkennung des Statements unter dem Cursor.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0095](../../toad-for-oracle-feature-audit.de.md#g11) (Einzelnes Statement ausführen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
