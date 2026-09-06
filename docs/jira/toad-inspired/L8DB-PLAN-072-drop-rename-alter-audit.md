# L8DB-PLAN-072: Tabellen und Views droppen, umbenennen, ändern und auditieren

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: DDL
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Nur `drop_table` und Spaltenänderungen existieren als Backend-Befehle; Drop/Rename von Views, Rename von Tabellen und eine lesende Audit-Ansicht fehlen.

## Umfang

Kontextmenü für Tabellen und Views mit Drop (mit Cascade-Option und Bestätigung), Rename und Alter — jeweils mit DDL-Vorschau nach dem Prinzip von L8DB-PLAN-041. Audit-Tab zeigt lesend die Audit-Trail-Einträge zum Objekt, soweit Provider und Rechte sie liefern.

## Akzeptanzkriterien

- [ ] Jede Aktion zeigt vorher das exakte DDL; Abbruch erzeugt kein Objekt.
- [ ] Drop verlangt Bestätigung und benennt abhängige Objekte.
- [ ] Audit-Einträge sind lesbar gefiltert; ohne Rechte erscheint ein Hinweis.

**Nicht enthalten:** Spalten-Rebuild, DBMS_REDEFINITION und mandantenweite Audit-Policies.

**Abhängigkeiten:** [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md) als Vorschau-Prinzip.

**Code-Anknüpfung:** [src/features/tables/create-table-view.tsx](../../../src/features/tables/create-table-view.tsx), [src/features/alter-table/alter-table-view.tsx](../../../src/features/alter-table/alter-table-view.tsx), [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0223](../../toad-for-oracle-feature-audit.de.md#g22) und [TOAD-0224](../../toad-for-oracle-feature-audit.de.md#g22) (Objekte erstellen/ändern; D26); [TOAD-0226](../../toad-for-oracle-feature-audit.de.md#g22) (DDL vor Ausführung anzeigen; D26); [TOAD-0229](../../toad-for-oracle-feature-audit.de.md#g22) (Objekte umbenennen; D26); [TOAD-0232](../../toad-for-oracle-feature-audit.de.md#g23) und [TOAD-0233](../../toad-for-oracle-feature-audit.de.md#g23) (Tabellen, Views; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
