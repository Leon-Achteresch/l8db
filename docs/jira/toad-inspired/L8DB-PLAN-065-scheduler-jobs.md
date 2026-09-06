# L8DB-PLAN-065: Scheduler-Jobs anzeigen und steuern

Typ: Story · Priorität: **P3** · Schätzung: **5 SP** · Bereich: Sessions
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Job- oder Queue-Tabellen lassen sich beobachten, echte Scheduler-Jobs jedoch nicht. l8db kennt keinen Job-Begriff.

## Umfang

Lesende Job-Übersicht mit Name, Status, letztem und nächstem Lauf sowie Aktionen Run, Enable und Disable. Oracle beginnt mit `DBMS_SCHEDULER` (Jobs, Programs, Schedules, Job Classes); PostgreSQL nutzt `pg_cron`, falls vorhanden. Alles hinter einer neuen Capability; vor Umsetzung technisch verfeinern.

## Akzeptanzkriterien

- [ ] Jobliste zeigt Status, letzten Lauf, nächsten Lauf und letzte Fehlermeldung.
- [ ] Run, Enable und Disable wirken nur auf den gewählten Job und respektieren Transaktionen.
- [ ] Ohne Scheduler-Rechte oder -Erweiterung erscheint ein Hinweis statt Fehlerstapel.

**Nicht enthalten:** Job-Designer, Skriptsammlungs-Runner und Windows-Task-Scheduler.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/sessions/sessions-view.tsx](../../../src/features/sessions/sessions-view.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0257](../../toad-for-oracle-feature-audit.de.md#g23) (Scheduler Jobs; D26); [TOAD-0256](../../toad-for-oracle-feature-audit.de.md#g23), [TOAD-0259](../../toad-for-oracle-feature-audit.de.md#g23), [TOAD-0260](../../toad-for-oracle-feature-audit.de.md#g23) (Chains, Programs, Schedules; D26); [TOAD-0506](../../toad-for-oracle-feature-audit.de.md#g44) (Messung über DBMS_JOB; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
