# L8DB-PLAN-028: Geladene Tabellenzeilen als INSERT-SQL exportieren

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Testdaten oder Fehlerfälle als ausführbares Skript teilen. Tabellen- und Queryexport bieten CSV und JSON.

## Umfang

PostgreSQL-INSERT-Datei aus geladenen Tabellenzeilen mit expliziter Spaltenliste erzeugen.

## Akzeptanzkriterien

- [ ] Zielname und Spalten werden korrekt gequotet.
- [ ] NULL, Strings, JSON und unterstützte Datentypen werden verlustfrei abgebildet; unbekannte Typen verhindern den Export mit Hinweis.
- [ ] Exportiert wird nur der ausgewiesene geladene Umfang; kein SQL wird ausgeführt.

**Nicht enthalten:** MERGE, beliebige Query-Ergebnisse und mehrere SQL-Dialekte.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0380](../../toad-for-oracle-feature-audit.de.md#g32) (INSERT-Statements; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
