# L8DB-PLAN-056: Zwei kleine PostgreSQL-Tabellen per Primärschlüssel vergleichen

Typ: Story · Priorität: **P3** · Schätzung: **5 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Abweichungen von Test- und Referenzdaten erkennen. Metadaten und Daten sind lesbar; ein Datenvergleich ist nicht vorhanden.

## Umfang

Zwei Tabellen gleicher Spaltenstruktur lesend vergleichen; maximal 10.000 Zeilen je Seite, native PostgreSQL-Verbindungen.

## Akzeptanzkriterien

- [ ] Primärschlüssel einschließlich zusammengesetzter Schlüssel identifizieren Zeilen.
- [ ] Nur Quelle, nur Ziel, geändert und gleich werden getrennt gezählt; NULL und präzise Werte bleiben korrekt.
- [ ] Fehlende Schlüssel, inkompatible Typen oder überschrittene Limits brechen mit Hinweis ab; keine Stichprobe wird als Vollvergleich ausgegeben.
- [ ] Erfassungszeitpunkte beider Seiten sind sichtbar; zeitgleiche Snapshots werden nicht behauptet.

**Nicht enthalten:** Schlüsselloser Vergleich, Cross-Engine-Vergleich und Synchronisierung.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0315](../../toad-for-oracle-feature-audit.de.md#g28) (Daten zwischen Schemas vergleichen; D26); [TOAD-0316](../../toad-for-oracle-feature-audit.de.md#g28) (Daten zwischen Datenbanken vergleichen; D26); [TOAD-0325](../../toad-for-oracle-feature-audit.de.md#g28) (Vergleichsspalten auswählen; D26); [TOAD-0330](../../toad-for-oracle-feature-audit.de.md#g29) (Primärschlüssel automatisch erkennen; H); [TOAD-0332](../../toad-for-oracle-feature-audit.de.md#g29) (Zusammengesetzte Vergleichsschlüssel; H); [TOAD-0336](../../toad-for-oracle-feature-audit.de.md#g29) (Geänderte Zeilen anhand Schlüssel erkennen; H); [TOAD-0338](../../toad-for-oracle-feature-audit.de.md#g29) (Nur in Quelle vorhandene Zeilen erkennen; H); [TOAD-0339](../../toad-for-oracle-feature-audit.de.md#g29) (Nur in Ziel vorhandene Zeilen erkennen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
