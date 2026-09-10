# L8DB-PLAN-063: Used-By-Tab für Tabellen und Views

Typ: Story · Priorität: **P2** · Schätzung: **5 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Vor einer Änderung sehen, welche Packages, Funktionen, Trigger und Views ein Objekt nutzen. TableView kennt nur Daten, Columns, Trigger, Indexes, RLS und Partitionen; ein Used-By-Tab fehlt.

## Umfang

Neuer lesender Detail-Tab „Used By“ für Tabellen und Views mit den Spalten Owner, Typ, Name und Status, Umschalter Tree/Grid sowie Kontextanzeige (Verbindung, Datenbank, Schema). Oracle löst über `ALL_DEPENDENCIES`, andere Provider über `pg_depend` beziehungsweise Quelltextsuche als Fallback.

## Akzeptanzkriterien

- [ ] Jede Zeile zeigt Owner, Objekttyp, Name und Status; Klick springt zum Objekt.
- [ ] Tree- und Grid-Darstellung sind umschaltbar; der Objektkontext bleibt sichtbar.
- [ ] Fehlende Leserechte erzeugen eine verständliche Meldung statt leerer Liste.

**Nicht enthalten:** Schreibzugriffe, Team-Coding-Status und Auditing.

**Abhängigkeiten:** [L8DB-PLAN-039](L8DB-PLAN-039-routinen-quelltextsuche.md) als Fallback für Provider ohne Dependency-Katalog.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0190](../../toad-for-oracle-feature-audit.de.md#g19) (Objektliste und Detailansicht; D26); [TOAD-0217](../../toad-for-oracle-feature-audit.de.md#g21) (Suche in gespeichertem Quellcode; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
