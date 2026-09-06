# L8DB-PLAN-037: Objektsuche über alle Schemas vervollständigen

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Auch Objekte großer Datenbanken ohne Sidebar-Suche erreichen. AppHeaderSearch nimmt nur die ersten 40 Tabellen auf; Verbindungen sind bereits suchbar.

## Umfang

Tabellen, Views und unterstützte Routinen in der Command Palette durchsuchen.

## Akzeptanzkriterien

- [ ] Ein Treffer außerhalb der ersten 40 Tabellen ist auffindbar.
- [ ] Schema und Objekttyp unterscheiden gleiche Namen.
- [ ] Suchergebnisse bleiben auf aktive Verbindung und Datenbank begrenzt; große Listen werden begrenzt dargestellt, nicht vor der Suche abgeschnitten.

**Nicht enthalten:** Alle Oracle-Objekttypen und Volltextsuche in Daten.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header-search.tsx](../../../src/features/shell/app-header-search.tsx), [src/features/sidebar/app-sidebar-panel.tsx](../../../src/features/sidebar/app-sidebar-panel.tsx), [src/lib/db.ts](../../../src/lib/db.ts)

**Toad-Bezug:** [TOAD-0215](../../toad-for-oracle-feature-audit.de.md#g21) (Suche nach Objektnamen; D26); [TOAD-0218](../../toad-for-oracle-feature-audit.de.md#g21) (Suche über mehrere Schemas; D26); [TOAD-0220](../../toad-for-oracle-feature-audit.de.md#g21) (Suche auf Objekttypen begrenzen; D26); [TOAD-0222](../../toad-for-oracle-feature-audit.de.md#g21) (Gleichnamige Objekte anhand Schema und Typ unterscheiden; D26); [TOAD-0822](../../toad-for-oracle-feature-audit.de.md#g75) (Jump Search für Funktionen und Hilfe; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
