# L8DB-PLAN-020: Text in geladenen Grid-Zellen suchen

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Grid
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Werte ohne Kenntnis ihrer Spalte finden. Der Tabellenbrowser hat Spaltenfilter; eine zellenübergreifende Treffernavigation ist nicht erkennbar.

## Umfang

Suchfeld mit Trefferhervorhebung sowie nächstem/vorherigem Treffer in Tabellen- und Ergebnisgrids.

## Akzeptanzkriterien

- [ ] Die Suche berücksichtigt sichtbare Spalten und die geladenen Zeilen.
- [ ] Trefferanzahl und Suchumfang sind sichtbar.
- [ ] Escape schließt die Suche und gibt den Fokus an die Zelle zurück.

**Nicht enthalten:** Alle Datenbankzeilen laden oder SQL-Suche ersetzen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0284](../../toad-for-oracle-feature-audit.de.md#g25) (Text im Grid suchen; D26); [TOAD-0285](../../toad-for-oracle-feature-audit.de.md#g25) (Inkrementelle Suche; D26); [TOAD-0639](../../toad-for-oracle-feature-audit.de.md#g64) (Grid-Such-/Filterpanel; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
