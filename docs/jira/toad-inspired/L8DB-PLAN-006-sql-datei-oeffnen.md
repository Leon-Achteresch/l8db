# L8DB-PLAN-006: SQL-Dateien in einem Query-Tab öffnen

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Editor
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Vorhandene Skripte vor Ausführung bequem bearbeiten. Der SQL-Import liest Dateien für die Ausführung; Query-Tabs haben keinen Datei-Öffnen-Ablauf.

## Umfang

Eine lokale UTF-8-SQL-Datei als neuen Query-Tab öffnen.

## Akzeptanzkriterien

- [ ] Öffnen erzeugt einen Tab mit Dateiname und unverändertem Text.
- [ ] Die Datei wird nicht automatisch ausgeführt.
- [ ] Lese- und Größenfehler erhalten die bestehenden Tabs unverändert.

**Nicht enthalten:** Ordnerbrowser und Ausführung im Importdialog ersetzen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0036](../../toad-for-oracle-feature-audit.de.md#g06) (SQL-Dateien öffnen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
