# L8DB-PLAN-004: Verbindungsfarbe im Arbeitsplatz anzeigen

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Verbindungen
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Produktions- und Entwicklungszugänge beim Arbeiten unterscheiden. Farbige Tags existieren, aber keine eindeutige Profilfarbe für den gesamten Arbeitsplatz.

## Umfang

Optionale Profilfarbe in Header, Query-Tabs und Statusleiste übernehmen.

## Akzeptanzkriterien

- [ ] Profilfarbe ist konfigurierbar und persistent.
- [ ] Beim Wechsel zeigen alle drei Stellen die neue Verbindung korrekt.
- [ ] Name und Kennzeichnung bleiben auch ohne Farbwahrnehmung verständlich.

**Nicht enthalten:** Farbe als Schreibschutz oder Berechtigung ausgeben.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/connections.ts](../../../src/lib/connections.ts), [src/features/connections/connection-editor.tsx](../../../src/features/connections/connection-editor.tsx), [src/lib/ssh.ts](../../../src/lib/ssh.ts)

**Toad-Bezug:** [TOAD-0028](../../toad-for-oracle-feature-audit.de.md#g05) (Verbindungen farblich kennzeichnen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
