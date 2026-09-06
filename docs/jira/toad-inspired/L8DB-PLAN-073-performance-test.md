# L8DB-PLAN-073: Performance-Test für Tabellen und Views

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Explain
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

EXPLAIN-Pläne lassen sich speichern und vergleichen, eine gezielte Laufzeitmessung für eine Tabelle oder View fehlt.

## Umfang

„Performance-Test“ im Tabellen- und View-Kontext: Standardabfrage mit `EXPLAIN (ANALYZE, BUFFERS)` ausführen, Laufzeit, Zeilenzahl und Plan anzeigen, Läufe wiederholen und zwei Läufe vergleichen. Lesend und begrenzt; kein Lastgenerator.

## Akzeptanzkriterien

- [ ] Test zeigt Laufzeit, Zeilen, Buffer und Plan je Lauf.
- [ ] Zwei Läufe sind vergleichbar; Filter und Sortierung bleiben erhalten.
- [ ] Langläufer sind abbrechbar; Abbrüche verändern keine Daten.

**Nicht enthalten:** Workload-Capture, verteilte Last und automatische Indexempfehlungen.

**Abhängigkeiten:** [L8DB-PLAN-045](L8DB-PLAN-045-explain-speichern.md), [L8DB-PLAN-047](L8DB-PLAN-047-explain-vergleichen.md) für Speicherung und Vergleich.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0167](../../toad-for-oracle-feature-audit.de.md#g17) (Gesamtlaufzeit je Programmeinheit; D26); verwandt mit [TOAD-0473](../../toad-for-oracle-feature-audit.de.md#g43) (Database Monitor; H) — bewusst nur als kleiner lesender Test übertragen, kein Benchmark-Produkt.

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
