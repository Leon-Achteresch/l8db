# L8DB-PLAN-002: Exportierte Verbindungsprofile importieren

Typ: Story · Priorität: **P1** · Schätzung: **3 SP** · Bereich: Verbindungen
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Wiederholte manuelle Einrichtung vermeiden. Es gibt eine Profilerstellung, aber keinen Importdialog.

## Umfang

Das JSON-Format aus Ticket 001 mit Vorschau importieren; Geheimnisse danach regulär erfassen.

## Akzeptanzkriterien

- [ ] Ungültige Versionen und Profile werden vor dem Speichern verständlich gemeldet.
- [ ] Dubletten können übersprungen oder als Kopie mit neuer ID übernommen werden.
- [ ] Import aktiviert keine Verbindung und verändert bestehende Profile nicht stillschweigend.

**Nicht enthalten:** Toad-/SQL-Developer-Fremdformate und automatischer Verbindungsaufbau.

**Abhängigkeiten:** [L8DB-PLAN-001](L8DB-PLAN-001-profile-exportieren.md)

**Code-Anknüpfung:** [src/lib/connections.ts](../../../src/lib/connections.ts), [src/features/connections/connection-editor.tsx](../../../src/features/connections/connection-editor.tsx), [src/lib/ssh.ts](../../../src/lib/ssh.ts)

**Toad-Bezug:** [TOAD-0023](../../toad-for-oracle-feature-audit.de.md#g04) (Verbindungsprofile importieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
