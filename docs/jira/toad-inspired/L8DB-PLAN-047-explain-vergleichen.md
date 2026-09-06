# L8DB-PLAN-047: Zwei gespeicherte Pläne vergleichen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Explain
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Planänderungen nach einer SQL- oder Indexänderung erkennen. Es gibt eine Einzelplanansicht, keinen Vergleich.

## Umfang

Zwei gespeicherte PostgreSQL-Pläne nebeneinander mit Planform und vorhandenen Laufzeitwerten darstellen.

## Akzeptanzkriterien

- [ ] Quelle, Zeitpunkt und SQL sind pro Seite sichtbar.
- [ ] Fehlende Messwerte werden nicht als null interpretiert.
- [ ] Bei unterschiedlichem SQL oder Datenbankkontext wird die eingeschränkte Vergleichbarkeit ausgewiesen.

**Nicht enthalten:** Automatischer Tuning-Ratgeber und behauptete statistische Signifikanz.

**Abhängigkeiten:** [L8DB-PLAN-046](L8DB-PLAN-046-explain-laden.md)

**Code-Anknüpfung:** [src/features/query/explain-plan-view.tsx](../../../src/features/query/explain-plan-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0712](../../toad-for-oracle-feature-audit.de.md#g67) (Ausführungspläne vergleichen; H); [TOAD-0694](../../toad-for-oracle-feature-audit.de.md#g66) (Ausführungsstatistiken vergleichen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
