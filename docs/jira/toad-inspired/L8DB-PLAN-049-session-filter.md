# L8DB-PLAN-049: Sitzungsliste nach Nutzer, App und Status filtern

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Sessions
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Eigene oder auffällige Aktivitäten in vollen Listen finden. Die Sitzungsliste zeigt alle geladenen Einträge ohne gezielte Filter.

## Umfang

Lokale Filter für Benutzer, Anwendungsname, Status und Query-Text; auf Toad-Monitoring übertragen.

## Akzeptanzkriterien

- [ ] Filter überstehen den vorhandenen Fünf-Sekunden-Refresh.
- [ ] Anzahl der Treffer und Gesamtzahl bleiben sichtbar.
- [ ] Zurücksetzen zeigt wieder den vollständigen geladenen Bestand.

**Nicht enthalten:** Serverseitige Langzeithistorie und neue Monitoringmetriken.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/sessions/sessions-view.tsx](../../../src/features/sessions/sessions-view.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts), [src-tauri/src/db/postgres.rs](../../../src-tauri/src/db/postgres.rs)

**Toad-Bezug:** [TOAD-0477](../../toad-for-oracle-feature-audit.de.md#g43) (Session-Aktivität überwachen; H); [TOAD-0521](../../toad-for-oracle-feature-audit.de.md#g45) (Aktivität als Tabelle darstellen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
