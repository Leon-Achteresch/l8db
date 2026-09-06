# L8DB-PLAN-050: Sitzungen nach Benutzer oder Anwendung gruppieren

Typ: Story · Priorität: **P3** · Schätzung: **2 SP** · Bereich: Sessions
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Aktivität mehrerer Clients übersichtlich zusammenfassen. Sessions werden als flache Tabelle dargestellt.

## Umfang

Optionale Gruppen mit Anzahl, Auf-/Zuklappen und persistierter Gruppierungswahl.

## Akzeptanzkriterien

- [ ] Gruppierung wechselt zwischen aus, Benutzer und Anwendung.
- [ ] Refresh erhält den Zustand vorhandener Gruppen.
- [ ] Filter aus Ticket 049 wirken vor der Gruppierung.

**Nicht enthalten:** Individuelle Layoutdesigner und Monitoring-Repository.

**Abhängigkeiten:** [L8DB-PLAN-049](L8DB-PLAN-049-session-filter.md)

**Code-Anknüpfung:** [src/features/sessions/sessions-view.tsx](../../../src/features/sessions/sessions-view.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts), [src-tauri/src/db/postgres.rs](../../../src-tauri/src/db/postgres.rs)

**Toad-Bezug:** [TOAD-0662](../../toad-for-oracle-feature-audit.de.md#g65) (Sessions nach Spalten gruppieren; D26); [TOAD-0663](../../toad-for-oracle-feature-audit.de.md#g65) (Session-Gruppierung speichern; D26); [TOAD-0665](../../toad-for-oracle-feature-audit.de.md#g65) (Session-Gruppen vollständig aufklappen; D26); [TOAD-0666](../../toad-for-oracle-feature-audit.de.md#g65) (Session-Gruppen vollständig zuklappen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
