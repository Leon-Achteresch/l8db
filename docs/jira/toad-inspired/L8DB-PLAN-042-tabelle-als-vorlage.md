# L8DB-PLAN-042: PostgreSQL-Tabellenspalten als Vorlage übernehmen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: DDL
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Ähnliche Tabellen mit weniger Eingaben erstellen. Ein Tabellenerstellungsformular existiert, aber keine Übernahme einer bestehenden Struktur.

## Umfang

Unterstützte Spalteneigenschaften einer bestehenden Tabelle in das Erstellungsformular übernehmen.

## Akzeptanzkriterien

- [ ] Nutzer vergibt einen neuen Zielnamen und sieht vor Ausführung die Vorschau.
- [ ] Nicht übernommene Eigenschaften wie Trigger, RLS, Fremdschlüssel und spezielle Defaults werden aufgelistet.
- [ ] Weder Zeilen noch an die Quelltabelle gebundene Sequenzen werden stillschweigend kopiert.

**Nicht enthalten:** Vollständiger Tabellenklon und Datenkopie.

**Abhängigkeiten:** [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md)

**Code-Anknüpfung:** [src/features/tables/create-table-view.tsx](../../../src/features/tables/create-table-view.tsx), [src/features/alter-table/alter-table-view.tsx](../../../src/features/alter-table/alter-table-view.tsx), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0230](../../toad-for-oracle-feature-audit.de.md#g22) (Bestehendes Objekt als Vorlage verwenden; D26); [TOAD-0231](../../toad-for-oracle-feature-audit.de.md#g22) (Vorlagenobjekt vor Erstellung anpassen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
