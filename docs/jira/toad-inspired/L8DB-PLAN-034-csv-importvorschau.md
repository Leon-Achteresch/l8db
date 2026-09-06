# L8DB-PLAN-034: CSV-Dateien für den Import voranzeigen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Import
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Dateistruktur prüfen, bevor Daten verändert werden. ImportView unterstützt SQL-Dateien, aber keine tabellarischen CSV-Dateien.

## Umfang

CSV/TSV lesen und mit wählbarem Trennzeichen und Headeroption voranzeigen; zunächst UTF-8, maximal 10 MB.

## Akzeptanzkriterien

- [ ] Quotes, mehrzeilige Felder und BOM werden korrekt verarbeitet.
- [ ] Vorschau ist auf 100 Zeilen begrenzt und zeigt Gesamtumfang oder dessen unbekannten Status.
- [ ] Datei-/Formatfehler ändern keine Datenbankdaten.

**Nicht enthalten:** Excel-Import, Datentypinferenz und Schreiben in Tabellen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/import/import-view.tsx](../../../src/features/import/import-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0429](../../toad-for-oracle-feature-audit.de.md#g39) (CSV-Daten importieren; H); [TOAD-0430](../../toad-for-oracle-feature-audit.de.md#g39) (Tab-getrennte Dateien importieren; H); [TOAD-0428](../../toad-for-oracle-feature-audit.de.md#g38) (Importvorschau/Zusammenfassung; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
