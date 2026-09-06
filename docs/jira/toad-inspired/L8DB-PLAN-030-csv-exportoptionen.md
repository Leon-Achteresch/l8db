# L8DB-PLAN-030: CSV-Export mit Vorschau konfigurieren

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Export
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Dateien passend zu Zielsystem und Tabellenkalkulation erzeugen. CSV-Serialisierung ist in zwei Views fest hinterlegt.

## Umfang

Gemeinsame CSV-Ausgabe mit Trennzeichen, Headeroption, LF/CRLF und NULL-Darstellung.

## Akzeptanzkriterien

- [ ] Vorschau und Datei nutzen denselben Serializer.
- [ ] Quotes, Trennzeichen und mehrzeilige Werte bestehen einen Roundtrip-Test.
- [ ] Tabellen- und Queryexport bieten dieselben Optionen.

**Nicht enthalten:** Encoding-Erkennung und Excel-Automation.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/table/table-view.tsx](../../../src/features/table/table-view.tsx), [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx)

**Toad-Bezug:** [TOAD-0377](../../toad-for-oracle-feature-audit.de.md#g32) (Delimited Text / CSV; H); [TOAD-0409](../../toad-for-oracle-feature-audit.de.md#g35) (Spaltenüberschriften im Export ein-/ausschließen; H); [TOAD-0413](../../toad-for-oracle-feature-audit.de.md#g37) (Zeilenende bei Flat-File-Export wählen; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
