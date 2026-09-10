# L8DB-PLAN-062: Verbindung und Datenbank im Fenstertitel anzeigen

Typ: Story · Priorität: **P2** · Schätzung: **1 SP** · Bereich: Shell
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Das richtige l8db-Fenster über den Betriebssystem-Fensterwechsel erkennen. Der Arbeitsplatz zeigt Kontext in der UI; ein dynamischer nativer Titel ist nicht als Feature erkennbar.

## Umfang

Nativer Titel mit App, Profilname und ausgewählter Datenbank.

## Akzeptanzkriterien

- [ ] Verbinden, Datenbankwechsel, Umbenennen und Trennen aktualisieren den Titel.
- [ ] Der Titel enthält keine URL und kein Passwort.
- [ ] Ohne Verbindung erscheint ein neutraler App-Titel.

**Nicht enthalten:** Fensterverwaltung und mehrere aktive Datenbankverbindungen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header.tsx](../../../src/features/shell/app-header.tsx), [src/features/shell/workspace-status.tsx](../../../src/features/shell/workspace-status.tsx)

**Toad-Bezug:** [TOAD-0656](../../toad-for-oracle-feature-audit.de.md#g64) (Datenbank im Fenstertitel anzeigen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
