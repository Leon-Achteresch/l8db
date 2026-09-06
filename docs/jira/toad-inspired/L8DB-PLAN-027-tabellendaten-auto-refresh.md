# L8DB-PLAN-027: Tabellendaten im sichtbaren Tab automatisch aktualisieren

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Änderungen etwa in Job- oder Queue-Tabellen beobachten. Sitzungen aktualisieren automatisch; Tabellendaten besitzen keinen entsprechenden Nutzer-Timer.

## Umfang

Optionale Intervalle 5, 15 und 30 Sekunden, standardmäßig aus.

## Akzeptanzkriterien

- [ ] Polling läuft nur im sichtbaren aktiven Tab.
- [ ] Filter, Sortierung und Seite bleiben erhalten.
- [ ] Bei Zellbearbeitung, offener Änderung oder laufendem Request pausiert der Timer; Fehler werden angezeigt.

**Nicht enthalten:** Hintergrundmonitoring und Query-Scheduler.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0205](../../toad-for-oracle-feature-audit.de.md#g19) (Aktives Dataset automatisch aktualisieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
