# L8DB-PLAN-040: Häufig verwendete Tabellen und Views anheften

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Wichtige Objekte unabhängig von offenen Tabs erreichen. Tabs speichern offene Objekte; eine eigenständige Favoritenliste fehlt.

## Umfang

Favoritenbereich in der Sidebar mit eigener Reihenfolge.

## Akzeptanzkriterien

- [ ] Favoriten werden nach Verbindung, Datenbank, Schema und Objekttyp gespeichert.
- [ ] Reihenfolge lässt sich ändern und bleibt erhalten.
- [ ] Nicht mehr vorhandene Objekte werden erkennbar und lassen sich entfernen.

**Nicht enthalten:** Favoriten für alle Objekttypen und Ordnerbäume.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header-search.tsx](../../../src/features/shell/app-header-search.tsx), [src/features/sidebar/app-sidebar-panel.tsx](../../../src/features/sidebar/app-sidebar-panel.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0688](../../toad-for-oracle-feature-audit.de.md#g65) (Schema-Favoriten per Drag-and-drop ordnen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
