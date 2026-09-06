# L8DB-PLAN-048: Blockierende PostgreSQL-Sitzungen verknüpft anzeigen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Sessions
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Die Ursache einer wartenden Query schneller finden. Sessions und Locks existieren als getrennte Listen; direkte Blocking-Ketten fehlen.

## Umfang

Blockiert-von-Beziehungen im Session-Kontext anzeigen und die verursachende Sitzung anspringen.

## Akzeptanzkriterien

- [ ] Blockierte und blockierende Sessions haben Textkennzeichnung und unterscheidbare Darstellung.
- [ ] Mehrere Blockierer und verschwundene Sessions werden korrekt behandelt.
- [ ] Vorhandene Cancel-/Terminate-Aktionen bleiben explizit; es wird nichts automatisch beendet.

**Nicht enthalten:** Oracle-RAC-Diagnose und automatische Auflösung von Sperren.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/sessions/sessions-view.tsx](../../../src/features/sessions/sessions-view.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts), [src-tauri/src/db/postgres.rs](../../../src-tauri/src/db/postgres.rs)

**Toad-Bezug:** [TOAD-0658](../../toad-for-oracle-feature-audit.de.md#g65) (Blockierte Sessions rot markieren; D26); [TOAD-0659](../../toad-for-oracle-feature-audit.de.md#g65) (Blockierende Sessions hervorheben; D26); [TOAD-0661](../../toad-for-oracle-feature-audit.de.md#g65) (Blocking-/Blocked-Unteransichten; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
