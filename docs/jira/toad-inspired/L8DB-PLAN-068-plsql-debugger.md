# L8DB-PLAN-068: PL/SQL-Debugger (schlanker Einstieg)

Typ: Story · Priorität: **P3** · Schätzung: **5 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

PL/SQL lässt sich ausführen, aber nicht schrittweise debuggen. Der Debugger ist bewusst ein eigener großer Providerbereich und braucht vor Umsetzung eine technische Verfeinerung.

## Umfang

Schlanker Start bei Oracle: mit Debug-Informationen kompilieren, Start mit Aufrufparametern, Step Into, Step Over, Ausführen bis Cursor, Haltepunkte am Editorrand und per Kürzel, Watches mit Call Stack sowie Stop. Hinter Capability; Debug-Informationen für Produktion entfernbar.

## Akzeptanzkriterien

- [ ] Debug-Sitzung startet nur mit expliziten Parametern; Haltepunkte halten an.
- [ ] Watches und Call Stack zeigen aktuelle Werte; Stop räumt die Sitzung auf.
- [ ] Ohne Debug-Rechte erscheint ein Hinweis; kein Fallback auf direkte Ausführung.

**Nicht enthalten:** Profiler, Code Tester und produktives Tracing.

**Abhängigkeiten:** [L8DB-PLAN-071](L8DB-PLAN-071-objekte-kompilieren.md) für das Kompilieren mit Debug-Informationen.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0136](../../toad-for-oracle-feature-audit.de.md#g14) bis [TOAD-0145](../../toad-for-oracle-feature-audit.de.md#g14) (Debugger mit Parametern; D26); [TOAD-0146](../../toad-for-oracle-feature-audit.de.md#g15) (Watches; D26); [TOAD-0149](../../toad-for-oracle-feature-audit.de.md#g15) (Call Stack; D26); [TOAD-0156](../../toad-for-oracle-feature-audit.de.md#g16) bis [TOAD-0158](../../toad-for-oracle-feature-audit.de.md#g16) (Haltepunkte; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
