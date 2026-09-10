# L8DB-PLAN-071: Funktionen, Prozeduren und Packages per Kontextmenü kompilieren

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: DDL
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Nach Quelltextänderungen gibt es keinen expliziten Compile-Befehl; ungültige Objekte fallen erst bei Ausführung auf.

## Umfang

Kontextmenü „Kompilieren“ für Funktionen, Prozeduren und Packages (Spec und Body getrennt), Statusanzeige VALID/INVALID und anspringbare Fehlermeldungen. Hinter Capability, zunächst Oracle und Postgres.

## Akzeptanzkriterien

- [ ] Kompilieren meldet Erfolg oder zeigt Fehler mit Zeilenbezug im Quelltext.
- [ ] Spec und Body sind getrennt kompilierbar; der Status aktualisiert die Anzeige.
- [ ] Fehler erzeugen keine Teilzustände außerhalb der Datenbanktransaktion.

**Nicht enthalten:** Automatisches Kompilieren beim Speichern und Debug-Informationen.

**Abhängigkeiten:** [L8DB-PLAN-070](L8DB-PLAN-070-prozeduren.md) für Prozeduren als kompilierbare Objekte.

**Code-Anknüpfung:** [src/features/functions/function-view.tsx](../../../src/features/functions/function-view.tsx), [src/features/view-editor/view-editor-view.tsx](../../../src/features/view-editor/view-editor-view.tsx), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0197](../../toad-for-oracle-feature-audit.de.md#g19) (Objekte kompilieren; D26); [TOAD-0136](../../toad-for-oracle-feature-audit.de.md#g14) (Mit Debug-Informationen kompilieren; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
