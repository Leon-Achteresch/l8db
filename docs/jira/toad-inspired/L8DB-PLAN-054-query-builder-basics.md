# L8DB-PLAN-054: Einfache SELECT-Abfrage grafisch erstellen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Query Builder
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Einfache Analysen ohne SQL-Vorkenntnisse beginnen. Der Tabellenbrowser hat einen Filterbuilder; ein SELECT-Modell fehlt.

## Umfang

Für eine PostgreSQL-Tabelle Spalten, einfache UND-Filter und Sortierung wählen; SQL in neuen Query-Tab übernehmen.

## Akzeptanzkriterien

- [ ] Generiertes SQL verwendet gequotete Identifikatoren und korrekt kodierte Literale.
- [ ] Eine Live-Vorschau zeigt das vollständige SQL.
- [ ] Übernehmen öffnet einen Tab und führt die Abfrage nicht aus.

**Nicht enthalten:** Joins, GROUP BY, Rückübersetzung beliebigen SQLs und weitere Provider.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/table-filter-panel.tsx](../../../src/features/table/table-filter-panel.tsx), [src/lib/sql-filter.ts](../../../src/lib/sql-filter.ts), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0115](../../toad-for-oracle-feature-audit.de.md#g13) (SELECT-Spalten per Checkbox; D26); [TOAD-0117](../../toad-for-oracle-feature-audit.de.md#g13) (WHERE-Bedingungen grafisch; D26); [TOAD-0120](../../toad-for-oracle-feature-audit.de.md#g13) (ORDER-BY-Zuordnung; D26); [TOAD-0122](../../toad-for-oracle-feature-audit.de.md#g13) (Generiertes SQL bearbeiten; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
