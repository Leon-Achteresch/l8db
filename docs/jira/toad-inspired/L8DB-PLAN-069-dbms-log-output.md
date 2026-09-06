# L8DB-PLAN-069: DBMS- und Log-Outputs anzeigen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

`DBMS_OUTPUT`- und Notice-Ausgaben haben keinen Anzeigeort; Skriptausgaben verschwinden nach der Ausführung.

## Umfang

Ausgabebereich im Query-Arbeitsplatz: Oracle `DBMS_OUTPUT` aktivieren, pollen und anzeigen; PostgreSQL-Notices und weitere Provider-Logs im selben Bereich sammeln. Ausgaben sind kopier- und löschbar und an die ausführende Sitzung gebunden.

## Akzeptanzkriterien

- [ ] DBMS_OUTPUT lässt sich je Sitzung aktivieren; Ausgaben erscheinen nach Ausführung.
- [ ] Notices und Skriptausgaben behalten ihre Sitzungs- und Zeit-Zuordnung.
- [ ] Leeren und Kopieren wirken nur auf die angezeigte Ausgabe, nie auf Daten.

**Nicht enthalten:** Alert Log, Trace-Dateien und AWR/StatsPack.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0159](../../toad-for-oracle-feature-audit.de.md#g16) bis [TOAD-0161](../../toad-for-oracle-feature-audit.de.md#g16) (DBMS Output; D26); [TOAD-0109](../../toad-for-oracle-feature-audit.de.md#g12) (DBMS_OUTPUT-Aufrufe generieren; D26); [TOAD-0155](../../toad-for-oracle-feature-audit.de.md#g15) (Skript-Ausgabe untersuchen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
