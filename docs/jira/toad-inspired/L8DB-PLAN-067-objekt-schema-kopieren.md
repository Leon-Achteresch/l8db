# L8DB-PLAN-067: Objekte vergleichen und in anderes Schema erstellen

Typ: Story · Priorität: **P2** · Schätzung: **5 SP** · Bereich: Vergleich
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Stände derselben Datenbank unter verschiedenen Schemas abgleichen und übernehmen. Definitionen lassen sich einzeln vergleichen, ein schemaübergreifender Objekttransfer fehlt.

## Umfang

Tabellen, Views, Funktionen und Packages derselben Datenbank zwischen zwei Schemas vergleichen (DDL-Diff) und per „Create in another Schema“ kopieren: DDL-Vorschau, optionaler Datentransfer bei Tabellen, Ausführung in Transaktion. Vor Umsetzung technisch verfeinern.

## Akzeptanzkriterien

- [ ] Quelle und Ziel zeigen Verbindung, Datenbank und beide Schemas; Diff ist lesbar.
- [ ] DDL-Vorschau entspricht genau der Ausführung; Namenskonflikte werden vorher gemeldet.
- [ ] Datentransfer ist opt-in, begrenzt und meldet Zeilenzahl oder bricht sauber ab.

**Nicht enthalten:** Datenbankübergreifende Kopie, DB Links und automatische Synchronisierung.

**Abhängigkeiten:** [L8DB-PLAN-043](L8DB-PLAN-043-definitionen-vergleichen.md), [L8DB-PLAN-041](L8DB-PLAN-041-create-table-ddl-vorschau.md)

**Code-Anknüpfung:** [src/features/tables/create-table-view.tsx](../../../src/features/tables/create-table-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0221](../../toad-for-oracle-feature-audit.de.md#g21) (Objekte in anderes Schema kopieren; D26); [TOAD-0307](../../toad-for-oracle-feature-audit.de.md#g27) (Tabellendaten in anderes Schema kopieren; D26); [TOAD-0315](../../toad-for-oracle-feature-audit.de.md#g28) (Daten zwischen Schemas vergleichen; D26); [TOAD-0342](../../toad-for-oracle-feature-audit.de.md#g30) (Einzelne Schemaobjekte vergleichen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
