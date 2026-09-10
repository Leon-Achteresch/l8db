# L8DB-PLAN-070: Prozeduren als eigene Objektfamilie

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Funktionen und Packages sind browsbar, Prozeduren nicht. Oracle-Objektbestände mit Prozeduren lassen sich nicht vollständig verwalten.

## Umfang

Prozeduren je Schema listen, Detail mit Parametern und Quelltext anzeigen, per Dialog mit Parametern ausführen und in Objekt- sowie Quelltextsuche aufnehmen. Neue Capability, zunächst Oracle und Postgres.

## Akzeptanzkriterien

- [ ] Prozedurliste zeigt Schema, Name, Parameterübersicht und Status.
- [ ] Ausführen fragt Parameter typgerecht ab und zeigt Ergebnis oder Fehler.
- [ ] Objekt- und Quelltextsuche finden Prozeduren wie Funktionen.

**Nicht enthalten:** Debugger, Profiler und Unit-Test-Manager.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/provider.rs](../../../src-tauri/src/db/provider.rs), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0237](../../toad-for-oracle-feature-audit.de.md#g23) (Prozeduren; D26); [TOAD-0105](../../toad-for-oracle-feature-audit.de.md#g12) (Neue PL/SQL-Objekte aus Vorlagen; D26); [TOAD-0111](../../toad-for-oracle-feature-audit.de.md#g12) (PL/SQL mit Parametern ausführen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
