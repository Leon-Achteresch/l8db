# L8DB-PLAN-017: Durchsuchbare Tastenkürzelhilfe anzeigen

Typ: Story · Priorität: **P2** · Schätzung: **1 SP** · Bereich: Shell
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Editor, Grid und Navigation schneller erlernen. Einzelne Tastenkürzel sind in Komponenten hinterlegt; eine zentrale Übersicht fehlt.

## Umfang

Hilfeansicht mit tatsächlich registrierten App-Befehlen und Plattformtasten.

## Akzeptanzkriterien

- [ ] macOS zeigt Cmd, andere Plattformen Ctrl korrekt.
- [ ] Suche filtert Befehl und Bereich.
- [ ] Nur verfügbare Aktionen werden als nutzbar dargestellt.

**Nicht enthalten:** Frei konfigurierbare Tastenzuordnung und Drucken.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/shell/app-header.tsx](../../../src/features/shell/app-header.tsx), [src/features/shell/workspace-status.tsx](../../../src/features/shell/workspace-status.tsx)

**Toad-Bezug:** [TOAD-0826](../../toad-for-oracle-feature-audit.de.md#g75) (Tastenkürzelliste drucken; D26); [TOAD-0628](../../toad-for-oracle-feature-audit.de.md#g62) (Editor-/Panel-Fokus per F6 konfigurieren; H); [TOAD-0629](../../toad-for-oracle-feature-audit.de.md#g62) (Symbolleisten per Tastatur fokussieren; H)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
