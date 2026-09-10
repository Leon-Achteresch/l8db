# L8DB-PLAN-075: Zeile duplizieren im Edit-State

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Grid
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Duplizieren schreibt die Kopie sofort und scheitert bei Primärschlüssel-Konflikten. Der PK lässt sich vorher nicht anpassen.

## Umfang

Kontextmenü „Als neue Zeile duplizieren“ öffnet den Neu-Dialog mit vorbelegten Werten im Edit-State; alle Felder inklusive PK bleiben änderbar, Validierung und Fehlerkommen erst beim Speichern. Nutzt denselben Insert- und Transaktionsablauf wie neue Zeilen.

## Akzeptanzkriterien

- [ ] Dialog ist mit allen kopierten Werten vorbelegt; PK ist editierbar.
- [ ] Speichern validiert wie bei neuen Zeilen; Abbruch erzeugt keine Zeile.
- [ ] Sofort-Duplizieren bleibt als separater Menüpunkt erhalten.

**Nicht enthalten:** Mehrfach-Duplikate und serielle Nummernkreise.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/table/data-table.tsx](../../../src/features/table/data-table.tsx), [src/features/table/new-row-dialog.tsx](../../../src/features/table/new-row-dialog.tsx), [src/lib/queries.ts](../../../src/lib/queries.ts)

**Toad-Bezug:** [TOAD-0294](../../toad-for-oracle-feature-audit.de.md#g26) (Vorhandene Zeile duplizieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
