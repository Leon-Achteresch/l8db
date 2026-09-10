# L8DB-PLAN-051: Gespeicherte Queries importieren und exportieren

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Bibliothek
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Abfragebibliotheken sichern und zwischen Rechnern austauschen. Benannte Queries werden lokal gespeichert und gesucht; Dateitransfer fehlt.

## Umfang

Auswahl als versioniertes JSON exportieren und mit Vorschau wieder importieren.

## Akzeptanzkriterien

- [ ] Name und SQL bleiben unverändert.
- [ ] Namenskollisionen werden als Kopie oder Überspringen aufgelöst.
- [ ] Import führt nichts aus; vor Export ist enthaltenes SQL einsehbar.

**Nicht enthalten:** Verlauf, Team-Sync und Verbindungspasswörter.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/saved-queries.ts](../../../src/lib/saved-queries.ts), [src/features/query/query-history-panel.tsx](../../../src/features/query/query-history-panel.tsx)

**Toad-Bezug:** [TOAD-0103](../../toad-for-oracle-feature-audit.de.md#g12) (Gespeicherte SQL-Statements importieren/exportieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
