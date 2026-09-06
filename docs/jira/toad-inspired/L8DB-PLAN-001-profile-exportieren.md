# L8DB-PLAN-001: Verbindungsprofile ohne Geheimnisse exportieren

Typ: Story · Priorität: **P1** · Schätzung: **2 SP** · Bereich: Verbindungen
Status: Umgesetzt · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Zugänge auf einen zweiten Rechner übertragen. Profile mit Tags und SSH-Konfiguration werden lokal gespeichert; ein Dateiexport ist nicht erkennbar.

## Umfang

Ausgewählte Profile als versionierte JSON-Datei exportieren.

## Akzeptanzkriterien

- [ ] Auswahl eines Teilbestands und Speicherort sind möglich.
- [ ] Passwörter, Tokens aus URLs/Optionen, SSH-Geheimnisse und Tunnelports fehlen im Export.
- [ ] Name, Providerfamilie, Tags und nicht geheime Verbindungsparameter bleiben erhalten.

**Nicht enthalten:** Verschlüsselte Passwortarchive und Cloud-Sync.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/connections.ts](../../../src/lib/connections.ts), [src/features/connections/connection-editor.tsx](../../../src/features/connections/connection-editor.tsx), [src/lib/ssh.ts](../../../src/lib/ssh.ts)

**Toad-Bezug:** [TOAD-0022](../../toad-for-oracle-feature-audit.de.md#g04) (Verbindungsprofile exportieren; D26); [TOAD-0024](../../toad-for-oracle-feature-audit.de.md#g04) (Passwörter beim Export weglassen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
