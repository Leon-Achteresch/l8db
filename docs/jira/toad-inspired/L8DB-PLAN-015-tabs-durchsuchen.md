# L8DB-PLAN-015: Text in offenen Query-Tabs suchen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

SQL in mehreren offenen Skripten wiederfinden. Monaco bietet Suche im einzelnen Editor; eine tabübergreifende Trefferliste fehlt.

## Umfang

Textsuche über Query-Tabs der aktiven Verbindung.

## Akzeptanzkriterien

- [ ] Treffer enthalten Tabname, Zeile und Textausschnitt.
- [ ] Auswahl aktiviert den passenden Tab und markiert den Treffer.
- [ ] Geänderte oder geschlossene Tabs werden in der Trefferliste berücksichtigt.

**Nicht enthalten:** Dateisystemsuche und tabübergreifendes Ersetzen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0044](../../toad-for-oracle-feature-audit.de.md#g06) (Dateiübergreifende Textsuche; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
