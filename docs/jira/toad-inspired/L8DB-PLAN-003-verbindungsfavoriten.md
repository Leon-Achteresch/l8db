# L8DB-PLAN-003: Verbindungen als Favoriten markieren

Typ: Story · Priorität: **P2** · Schätzung: **1 SP** · Bereich: Verbindungen
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Häufige Zugänge schneller finden. Tags sind vorhanden; ein eigenes Favoritenfeld fehlt im Profilmodell.

## Umfang

Favoritenstern an Profilen und Filter in der Verbindungsübersicht.

## Akzeptanzkriterien

- [ ] Favoriten bleiben nach Neustart erhalten.
- [ ] Der Filter zeigt nur markierte Profile und einen sinnvollen Leerzustand.
- [ ] Markieren baut keine Verbindung auf.

**Nicht enthalten:** Neue Ordnerhierarchie.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/connections.ts](../../../src/lib/connections.ts), [src/features/connections/connection-editor.tsx](../../../src/features/connections/connection-editor.tsx), [src/lib/ssh.ts](../../../src/lib/ssh.ts)

**Toad-Bezug:** [TOAD-0029](../../toad-for-oracle-feature-audit.de.md#g05) (Nur favorisierte Verbindungen anzeigen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
