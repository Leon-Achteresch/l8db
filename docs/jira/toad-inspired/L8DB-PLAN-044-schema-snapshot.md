# L8DB-PLAN-044: PostgreSQL-Tabellenmetadaten als Snapshot speichern

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Einen Schemaausschnitt später nachvollziehen können. Metadaten werden live gelesen; ein versionierter Offline-Snapshot fehlt.

## Umfang

Tabellen, Spalten und Primärschlüssel eines Schemas als versionierte JSON-Datei exportieren.

## Akzeptanzkriterien

- [ ] Version, Erfassungszeit und expliziter Objektumfang sind enthalten.
- [ ] Die Datei enthält keine Zeilendaten oder Verbindungsgeheimnisse.
- [ ] Fehlende Berechtigungen führen zu einem sichtbaren unvollständigen Status oder Abbruch.

**Nicht enthalten:** Vollständige Backups, Index-/Triggerdefinitionen und Schema-Synchronisierung.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0356](../../toad-for-oracle-feature-audit.de.md#g30) (Schema-Snapshots erzeugen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
