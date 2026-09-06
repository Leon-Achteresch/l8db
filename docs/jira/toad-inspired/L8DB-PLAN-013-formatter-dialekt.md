# L8DB-PLAN-013: SQL-Formatierung nach Provider auswählen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Formatierung
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

SQL anderer unterstützter Familien korrekt formatieren. formatSql verwendet fest den PostgreSQL-Dialekt.

## Umfang

Formatter-Dialekt über Provider-Metadaten auswählen und auch für Bereichsformatierung verwenden.

## Akzeptanzkriterien

- [ ] Unterstützte SQL-Familien erhalten den passenden Formatter-Dialekt.
- [ ] Nicht-SQL-Provider bieten keine SQL-Formatierung an.
- [ ] Ein Formatierungsfehler lässt den Text unverändert und meldet den Grund.

**Nicht enthalten:** Neue SQL-Parser oder automatische Dialektkonvertierung.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/monaco.ts](../../../src/lib/monaco.ts), [src/lib/settings.ts](../../../src/lib/settings.ts)

**Toad-Bezug:** [TOAD-0085](../../toad-for-oracle-feature-audit.de.md#g10) (Code formatieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
