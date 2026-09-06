# L8DB-PLAN-064: Synonyme browsen und auflösen

Typ: Story · Priorität: **P3** · Schätzung: **3 SP** · Bereich: Objekte
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Synonyme sind in l8db weder browsbar noch auflösbar; Verweise über Synonyme lassen sich nicht nachverfolgen.

## Umfang

Synonyme je Schema listen, Zielobjekt auflösen (auch Ketten), Status anzeigen und per Klick zum Zielobjekt springen. Neue Capability, zunächst Oracle und Provider mit Synonym-Katalog.

## Akzeptanzkriterien

- [ ] Synonymliste zeigt Name, Ziel (Schema, Objekt, Typ) und Gültigkeit.
- [ ] Ketten werden bis zum Basisobjekt aufgelöst; Zirkel werden gemeldet.
- [ ] Klick öffnet das Zielobjekt im passenden Detail-Tab.

**Nicht enthalten:** Erstellen und Löschen von Synonymen.

**Abhängigkeiten:** Keine neuen Backlog-Tickets erforderlich.

**Code-Anknüpfung:** [src/lib/queries.ts](../../../src/lib/queries.ts), [src/lib/db.ts](../../../src/lib/db.ts), [src-tauri/src/db/provider.rs](../../../src-tauri/src/db/provider.rs), [src-tauri/src/db/mod.rs](../../../src-tauri/src/db/mod.rs)

**Toad-Bezug:** [TOAD-0114](../../toad-for-oracle-feature-audit.de.md#g13) (Synonyme ins Abfragemodell ziehen; D26); [TOAD-0214](../../toad-for-oracle-feature-audit.de.md#g21) (Objekte mit Describe untersuchen; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
