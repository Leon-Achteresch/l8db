# L8DB-PLAN-014: Einrückung und Keyword-Schreibweise konfigurieren

Typ: Story · Priorität: **P2** · Schätzung: **2 SP** · Bereich: Formatierung
Status: Vorschlag · Labels: `toad-inspired`, `l8db-backlog`

## Nutzen und Ist-Stand

Formatierung an das Projekt anpassen. Zwei Leerzeichen und Großschreibung sind fest im Formatter eingestellt.

## Umfang

Zwei Einstellungen für Einrückungsbreite und Keyword-Schreibweise mit Vorschau.

## Akzeptanzkriterien

- [ ] Einstellungen bleiben nach Neustart erhalten.
- [ ] Dokument- und Auswahlformatierung nutzen dieselben Werte.
- [ ] Zurücksetzen stellt die bisherigen Standardwerte wieder her.

**Nicht enthalten:** Vollständiger Toad-Formatter-Regelkatalog.

**Abhängigkeiten:** [L8DB-PLAN-013](L8DB-PLAN-013-formatter-dialekt.md)

**Code-Anknüpfung:** [src/lib/monaco.ts](../../../src/lib/monaco.ts), [src/lib/settings.ts](../../../src/lib/settings.ts)

**Toad-Bezug:** [TOAD-0085](../../toad-for-oracle-feature-audit.de.md#g10) (Code formatieren; D26); [TOAD-0088](../../toad-for-oracle-feature-audit.de.md#g10) (Groß-/Kleinschreibung umwandeln; D26)

Es gilt der [gemeinsame Umsetzungsrahmen](README.md#umsetzungsrahmen).
