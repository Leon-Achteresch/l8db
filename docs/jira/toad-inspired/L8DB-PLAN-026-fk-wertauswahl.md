# L8DB-PLAN-026: Fremdschlüsselwert über Referenztabelle auswählen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Gültige Referenzen ohne Kopieren technischer IDs auswählen. Referenzvorschau und Navigation existieren; ein Wertepicker für die Bearbeitung fehlt.

## Umfang

Picker für einspaltige PostgreSQL-Fremdschlüssel beim Bearbeiten einer Zelle.

## Akzeptanzkriterien

- [ ] Suche und Pagination begrenzen die geladenen Referenzwerte.
- [ ] Auswahl übernimmt den Schlüssel, nicht den Anzeigetext.
- [ ] NULL ist nur bei nullable Zielspalte zulässig; Speichern nutzt die bestehende Transaktion.

**Nicht enthalten:** Zusammengesetzte Schlüssel und frei programmierbares Lookup-SQL.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0265](../../toad-for-oracle-feature-audit.de.md#g24) (Fremdschlüsselwerte aus Referenztabelle übernehmen; D26); [TOAD-0268](../../toad-for-oracle-feature-audit.de.md#g24) (Lookup durch Tippen filtern; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
