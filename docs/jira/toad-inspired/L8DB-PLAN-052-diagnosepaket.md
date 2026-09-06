# L8DB-PLAN-052: Einsehbares Diagnosepaket lokal erstellen

Typ: Story · Priorität: **P2** · Schätzung: **3 SP** · Bereich: Support
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Fehlerberichte mit brauchbarem technischen Kontext erstellen. App- und Treiberinformationen sind über mehrere Ansichten verteilt.

## Umfang

App-Version, Betriebssystem, Treiberstatus und bereinigte Einstellungen als lokale JSON-Datei bündeln.

## Akzeptanzkriterien

- [ ] Alle enthaltenen Felder sind vor dem Speichern einsehbar.
- [ ] Verbindungs-URLs, Geheimnisse, SQL-Verlauf und Ergebnisdaten werden nicht aufgenommen.
- [ ] Das Paket wird nur lokal gespeichert; Sammelfehler erscheinen im Paketstatus.

**Nicht enthalten:** Automatischer Upload und Sammlung vollständiger Logs.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/features/about/about-view.tsx](../../../src/features/about/about-view.tsx), [src/features/drivers/drivers-view.tsx](../../../src/features/drivers/drivers-view.tsx), [src/lib/secrets.ts](../../../src/lib/secrets.ts)

**Toad-Bezug:** [TOAD-0824](../../toad-for-oracle-feature-audit.de.md#g75) (Support-Bundle erstellen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
