# L8DB-PLAN-035: CSV-Spalten einer PostgreSQL-Tabelle zuordnen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Import
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Fehlzuordnungen und Pflichtfeldfehler vor dem Import finden. Es existiert kein CSV-Zuordnungsdialog.

## Umfang

Zieltabelle wählen, Namensvorschläge übernehmen und Spalten manuell zuordnen oder auslassen.

## Akzeptanzkriterien

- [ ] Vorschläge sind sichtbar und bearbeitbar.
- [ ] Doppelte Zielzuordnungen und fehlende Pflichtwerte blockieren den nächsten Schritt.
- [ ] Default-, Identity- und generierte Spalten werden ausdrücklich berücksichtigt; NULL und Leerstring bleiben unterscheidbar.

**Nicht enthalten:** Automatische Tabellenerstellung und Upsert.

**Abhängigkeiten:** [L8DB-PLAN-034](L8DB-PLAN-034-csv-importvorschau.md)

**Code-Anknüpfung:** [src/features/import/import-view.tsx](../../../src/features/import/import-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0420](../../toad-for-oracle-feature-audit.de.md#g38) (Importziel aus Schema und Objekt auswählen; H); [TOAD-0423](../../toad-for-oracle-feature-audit.de.md#g38) (Spaltenzuordnung prüfen; H); [TOAD-0424](../../toad-for-oracle-feature-audit.de.md#g38) (Automatisches Spaltenmapping; H); [TOAD-0425](../../toad-for-oracle-feature-audit.de.md#g38) (Manuelles Spaltenmapping; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
