# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 20: Herkunft bleibt vorn. Drei Kandidaten bleiben; die neuen Vergleichsfälle begründen noch keine zusätzliche Auswahl- oder Orientierungshilfe.**

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnlich benannte Abfragen in der bestehenden Liste unterscheidbar machen; allgemeine Abfragen bleiben sichtbar. Der [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt die Aufgabe, der Zusatznutzen gegenüber Verlauf und Ordnern bleibt für gemischte Bestände offen.

2. **ClickHouse-Abbruch verlässlich anzeigen.** Nach „Abbrechen“ soll klar sein, ob die Abfrage beendet oder der Abbruch nur angefordert ist. Ein [Superset-Commit vom 7. Oktober](https://github.com/apache/superset/commit/68a11500cfc54aa5136d81d6c04bc1e02f84422e) und der bekannte l8db-Codehinweis stützen den Vorschlag; ein aktueller direkter Anwenderfall und ein l8db-Laufzeitbeleg fehlen.

3. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

[Vergleichsfälle und vorhandene Funktionen](sources.md#runde-20--große-select-ergebnisse-auswahl-und-orientierung) · [Backlog](backlog.md). Ergebnis- und Tabellenvergleich, Schlüsselwahl und Änderungsdetails existieren bereits; kein neuer Vergleichsmotor empfohlen. Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Die offene Aufgabe „bekannte ID, Tabelle unbekannt“ gegen vorhandene Datenwertsuche und neue Originalfälle prüfen. Geschlossene Suchstränge nur mit neuem Ausgangsbeleg öffnen.
