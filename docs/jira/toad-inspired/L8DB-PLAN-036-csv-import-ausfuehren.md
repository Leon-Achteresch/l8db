# L8DB-PLAN-036: Kleinen CSV-Import atomar in PostgreSQL ausführen

Typ: Story · Priorität: **P1** · Schätzung: **5 SP** · Bereich: Import
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Validierte Daten mit klarer Fehlerbehandlung übernehmen. Es gibt einen SQL-Skriptimport, aber keinen CSV-Schreibpfad.

## Umfang

Gemappte CSV-Daten als INSERT in einer eigenen Transaktion importieren, maximal 10.000 Zeilen/10 MB.

## Akzeptanzkriterien

- [ ] Ziel und Anzahl werden vor Start angezeigt; eine bestehende Nutzertransaktion verhindert den Start.
- [ ] Ein Fehler rollt den gesamten Import zurück und nennt Datensatz und betroffene Spalte soweit verfügbar.
- [ ] Abbruch rollt zurück; Erfolg zeigt ausschließlich bestätigte importierte Zeilen.

**Nicht enthalten:** Teilcommits, UPDATE/UPSERT und große Streamingimporte.

**Abhängigkeiten:** [L8DB-PLAN-035](L8DB-PLAN-035-csv-spaltenmapping.md)

**Code-Anknüpfung:** [src/features/import/import-view.tsx](../../../src/features/import/import-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0426](../../toad-for-oracle-feature-audit.de.md#g38) (Importmodus wählen; H); [TOAD-0427](../../toad-for-oracle-feature-audit.de.md#g38) (Commit-Verhalten beim Import wählen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
