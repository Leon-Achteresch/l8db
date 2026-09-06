# L8DB-PLAN-038: Spalten datenbankweit suchen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Unbekannte Tabellen anhand eines Feldnamens finden. Spaltenmetadaten dienen bereits der Completion; es fehlt eine nutzbare Spaltensuche.

## Umfang

Spaltensuche mit Schemafilter für Provider mit verfügbarer Spaltenmetadaten-Abfrage.

## Akzeptanzkriterien

- [ ] Treffer zeigen Schema, Tabelle, Spalte und Datentyp.
- [ ] Öffnen führt zur Tabelle und markiert die Spalte.
- [ ] Fehlende Berechtigungen werden als Fehler oder begrenzter Umfang ausgewiesen.

**Nicht enthalten:** Suche in Zeilenwerten.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header-search.tsx](../../../src/features/shell/app-header-search.tsx), [src/features/sidebar/app-sidebar-panel.tsx](../../../src/features/sidebar/app-sidebar-panel.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0216](../../toad-for-oracle-feature-audit.de.md#g21) (Suche nach Spaltennamen; D26); [TOAD-0218](../../toad-for-oracle-feature-audit.de.md#g21) (Suche über mehrere Schemas; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
