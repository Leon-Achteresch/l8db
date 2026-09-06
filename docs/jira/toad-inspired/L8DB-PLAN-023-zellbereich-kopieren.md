# L8DB-PLAN-023: Zellbereiche auswählen und als TSV kopieren

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Ausschnitte direkt in Tabellenkalkulationen übernehmen. Einzelne aktive Zellen können kopiert werden; eine rechteckige Auswahl fehlt.

## Umfang

Rechteckige Auswahl mit Maus und Shift-Tastatur; TSV in Zwischenablage.

## Akzeptanzkriterien

- [ ] Auswahl folgt der sichtbaren Spalten- und Zeilenreihenfolge.
- [ ] Tabs, Zeilenumbrüche und NULL werden nach dokumentierten Regeln serialisiert.
- [ ] Kopieren verändert keine Zeile; Auswahlanzahl wird angezeigt.

**Nicht enthalten:** Mehrzellen-Paste und Massenschreiboperationen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/lib/table-column-prefs.ts](../../../src/lib/table-column-prefs.ts)

**Toad-Bezug:** [TOAD-0101](../../toad-for-oracle-feature-audit.de.md#g11) (SQL-Ergebnis in Zwischenablage übernehmen; D26); [TOAD-0684](../../toad-for-oracle-feature-audit.de.md#g65) (Auswahlzeilenzahl anzeigen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
