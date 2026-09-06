# L8DB-PLAN-058: ER-Diagramm auf eine Tabelle und ihre Nachbarn begrenzen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: ER
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Große Schemas schrittweise verstehen. ER-Diagramm mit Layout, Zoom und PNG-/SVG-/PDF-Export ist bereits vorhanden.

## Umfang

Starttabelle und Beziehungstiefe 0 bis 2 für den sichtbaren Ausschnitt auswählen.

## Akzeptanzkriterien

- [ ] Tiefe null zeigt nur die Starttabelle; größere Tiefe enthält die entsprechenden FK-Nachbarn.
- [ ] Zyklen erzeugen keine doppelten Knoten und Schemaidentitäten bleiben erhalten.
- [ ] Bestehender Export exportiert den gewählten Ausschnitt.

**Nicht enthalten:** Neue Exportformate und vollständiger Datenmodellierer.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/er-diagram/er-diagram-view.tsx](../../../src/features/er-diagram/er-diagram-view.tsx)

**Toad-Bezug:** [TOAD-0401](../../toad-for-oracle-feature-audit.de.md#g32) (ER-Diagramm aus gewählter Tabelle; H); [TOAD-0402](../../toad-for-oracle-feature-audit.de.md#g32) (FK-Beziehungstiefe im ER-Diagramm wählen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
