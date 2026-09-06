# L8DB-PLAN-039: PostgreSQL-Routinen und Views im Quelltext durchsuchen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Verwendungen eines Namens in Datenbankcode finden. Definitionen lassen sich einzeln öffnen; eine Quelltextsuche über Objekte fehlt.

## Umfang

Textsuche in sichtbaren View- und Routinen-Definitionen mit Schemafilter.

## Akzeptanzkriterien

- [ ] Treffer enthalten Objektidentität und Quelltextausschnitt.
- [ ] Öffnen zeigt die Definition an der Fundstelle.
- [ ] Überladene Routinen bleiben über ihre Identität unterscheidbar; Suchfehler werden nicht als null Treffer ausgegeben.

**Nicht enthalten:** Vollständiger Abhängigkeitsgraph und semantisches Refactoring.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header-search.tsx](../../../src/features/shell/app-header-search.tsx), [src/features/sidebar/app-sidebar-panel.tsx](../../../src/features/sidebar/app-sidebar-panel.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0217](../../toad-for-oracle-feature-audit.de.md#g21) (Suche in gespeichertem Quellcode; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
