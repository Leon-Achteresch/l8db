# L8DB-PLAN-005: PostgreSQL-Verbindungen im Lesemodus öffnen

Typ: Story · Priorität: **P2** · Schätzung: **5 SP** · Bereich: Verbindungen
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Unbeabsichtigte Änderungen über einen Analysezugang verhindern. Providerabhängige Schreibrechte der UI existieren; ein profilbezogener Lesemodus fehlt.

## Umfang

Für native PostgreSQL-Verbindungen einen Lesemodus durchsetzen; Moduswechsel verlangt Neuverbindung.

## Akzeptanzkriterien

- [ ] Schreibende l8db-Kommandos sind in UI und Backend im Lesemodus gesperrt.
- [ ] Query- und Skriptausführung verwenden serverseitige Read-only-Transaktionen; SQL darf den Schutz nicht umschalten.
- [ ] Ein Verbindungswechsel mit offenen Änderungen nutzt den bestehenden Transaktionsablauf; der Modus wird erst danach wirksam.
- [ ] Direkte Command-Aufrufe und SQL mit CTE/DML werden in einem PostgreSQL-Integrationstest abgewiesen.

**Nicht enthalten:** Schutz außerhalb von l8db, Superuser-Sicherheitsgrenze und Unterstützung aller Provider. Falls sichere SQL-Ausführung nicht gewährleistet ist, wird sie im Lesemodus gesperrt.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/connections.ts](../../../src/lib/connections.ts), [src/features/connections/connection-editor.tsx](../../../src/features/connections/connection-editor.tsx), [src/lib/ssh.ts](../../../src/lib/ssh.ts)

**Toad-Bezug:** [TOAD-0817](../../toad-for-oracle-feature-audit.de.md#g74) (Verbindung als Read Only markieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
