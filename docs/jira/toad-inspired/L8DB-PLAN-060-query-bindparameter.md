# L8DB-PLAN-060: PostgreSQL-Abfragen mit Bind-Parametern ausführen

Typ: Story · Priorität: **P2** · Schätzung: **5 SP** · Bereich: Editor
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Wiederkehrende Abfragen ohne manuelles Einsetzen von Literalen ausführen. executeQuery bekommt bislang SQL-Text ohne separate Parameterwerte.

## Umfang

Parameterdialog für $1 bis $n und Backend-Binding zunächst für Text, Ganzzahl, Boolean und NULL.

## Akzeptanzkriterien

- [ ] Werte werden separat gebunden und nicht per Stringersetzung in SQL eingefügt.
- [ ] Fehlende oder ungültige Parameter verhindern die Ausführung.
- [ ] Der Verlauf speichert SQL mit Platzhaltern, keine Parameterwerte; Transaktionspfad unterstützt dieselbe Bindung.

**Nicht enthalten:** Automatische Typinferenz, persistierte Geheimnisse und andere Dialekte.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/query/query-view.tsx](../../../src/features/query/query-view.tsx), [src/features/query/query-editor-pane.tsx](../../../src/features/query/query-editor-pane.tsx), [src/lib/table-tabs.ts](../../../src/lib/table-tabs.ts)

**Toad-Bezug:** [TOAD-0707](../../toad-for-oracle-feature-audit.de.md#g67) (Bind-Werte für Tests definieren; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
