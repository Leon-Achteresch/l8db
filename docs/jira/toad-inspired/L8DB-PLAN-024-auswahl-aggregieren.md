# L8DB-PLAN-024: Kennzahlen für markierte Zellen anzeigen

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Summen und Mittelwerte ohne zusätzliche SQL-Abfrage prüfen. Es gibt keine Auswahlstatistik unter dem Grid.

## Umfang

Anzahl, Anzahl numerischer Werte, Summe und Mittelwert für die aktuelle Auswahl.

## Akzeptanzkriterien

- [ ] NULL und Text gehen nicht in numerische Berechnungen ein.
- [ ] Zahlen werden nicht stillschweigend präzisionsverlustig konvertiert; nicht unterstützte Werte werden ausgewiesen.
- [ ] Leere Auswahl blendet die Kennzahlen aus.

**Nicht enthalten:** Datenbankweite Aggregate und Zellformeln.

**Abhängigkeiten:** [L8DB-PLAN-023](L8DB-PLAN-023-zellbereich-kopieren.md)

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0299](../../toad-for-oracle-feature-audit.de.md#g26) (Summe markierter Zellen; D26); [TOAD-0300](../../toad-for-oracle-feature-audit.de.md#g26) (Mittelwert markierter Zellen; D26); [TOAD-0301](../../toad-for-oracle-feature-audit.de.md#g26) (Anzahl markierter Zellen; D26); [TOAD-0302](../../toad-for-oracle-feature-audit.de.md#g26) (Berechnungszeile unter dem Grid; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
