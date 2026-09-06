# L8DB-PLAN-011: Eigene SQL-Snippets verwalten

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Wiederkehrende SQL-Bausteine zentral pflegen. Metadatenbasierte Completion existiert; eine eigene Snippet-Bibliothek ist nicht erkennbar.

## Umfang

Lokale Snippets mit Name, Kürzel, Beschreibung, Kategorie und SQL-Text.

## Akzeptanzkriterien

- [ ] Anlegen, Bearbeiten und Löschen bleiben nach Neustart erhalten.
- [ ] Doppelte Kürzel werden vor dem Speichern gemeldet.
- [ ] Suche findet Name, Kategorie und Beschreibung.

**Nicht enthalten:** Team-Sync und automatische Ausführung.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0074](../../toad-for-oracle-feature-audit.de.md#g09) (Eigene Codesnippets; D26); [TOAD-0075](../../toad-for-oracle-feature-audit.de.md#g09) (Snippet-Kategorien; D26); [TOAD-0076](../../toad-for-oracle-feature-audit.de.md#g09) (Beschreibungen für Snippets; D26); [TOAD-0077](../../toad-for-oracle-feature-audit.de.md#g09) (Snippets bearbeiten; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
