# L8DB-PLAN-074: Migrationsskripte automatisch erstellen

Typ: Story · Priorität: **P3** · Schätzung: **5 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Definitionen und Daten lassen sich vergleichen, das Migrationsskript muss von Hand geschrieben werden. Vor Umsetzung technisch verfeinern.

## Umfang

Aus Schema-Diff und Snapshots automatisch ein geordnetes Migrationsskript erzeugen (DDL-Differenzen, danach Daten-Sync), mit Vorschau, Speichern und Übergabe an den Editor zur Nachbearbeitung. Keine automatische Ausführung ohne ausdrückliche Bestätigung.

## Akzeptanzkriterien

- [ ] Skript ist aus dem angezeigten Diff nachvollziehbar und erneut erzeugbar.
- [ ] Reihenfolge beachtet Abhängigkeiten; nicht abbildbare Differenzen werden gemeldet.
- [ ] Ausführung läuft nur bestätigt über die vorhandene Transaktionsverwaltung.

**Nicht enthalten:** Automatische Schema-Synchronisierung und Datenbank-Rebuild.

**Abhängigkeiten:** [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md), [L8DB-PLAN-044](L8DB-PLAN-044-schema-snapshot.md), [L8DB-PLAN-057](L8DB-PLAN-057-datendifferenz-sql.md)

**Code-Anknüpfung:** [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0352](../../toad-for-oracle-feature-audit.de.md#g30) (Objekt-Synchronisierungsskript; D26); [TOAD-0326](../../toad-for-oracle-feature-audit.de.md#g28) bis [TOAD-0328](../../toad-for-oracle-feature-audit.de.md#g28) (Synchronisierungsskript erzeugen, speichern, nachbearbeiten; D26); [TOAD-0364](../../toad-for-oracle-feature-audit.de.md#g31) (Datenbank-Synchronisierungsskript; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
