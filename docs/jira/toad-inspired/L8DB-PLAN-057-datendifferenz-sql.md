# L8DB-PLAN-057: INSERT- und UPDATE-Skript aus Datenvergleich erzeugen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Ausgewählte kleine Abweichungen kontrolliert übernehmen. Eine Skriptausgabe für Datenunterschiede existiert noch nicht.

## Umfang

Für ausgewählte Quelle-neu- und geändert-Zeilen aus Ticket 056 PostgreSQL-SQL erzeugen.

## Akzeptanzkriterien

- [ ] Vorschau zeigt Zielobjekt, betroffene Schlüssel und geplante Änderungen.
- [ ] UPDATE enthält eine Prüfung des erwarteten Altstands; Änderungen seit dem Vergleich werden nicht blind überschrieben.
- [ ] Skript lässt sich speichern oder in einen neuen Tab laden, wird aber nicht automatisch ausgeführt.

**Nicht enthalten:** DELETE, Schemaänderungen und automatische Konfliktauflösung.

**Abhängigkeiten:** [L8DB-PLAN-056](L8DB-PLAN-056-tabellendaten-vergleichen.md), [L8DB-PLAN-028](L8DB-PLAN-028-insert-export.md)

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0326](../../toad-for-oracle-feature-audit.de.md#g28) (Synchronisierungsskript erzeugen; D26); [TOAD-0327](../../toad-for-oracle-feature-audit.de.md#g28) (Synchronisierungsskript speichern; D26); [TOAD-0328](../../toad-for-oracle-feature-audit.de.md#g28) (Synchronisierungsskript im Editor nachbearbeiten; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
