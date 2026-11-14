# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 18: Herkunft bleibt vorn. Drei Kandidaten bleiben; Skriptfehler sind bereits einzelnen Anweisungen zugeordnet, eine zusätzliche Orientierungslücke ist nicht belegt.**

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnliche Namen in der bestehenden Liste unterscheidbar machen. Der [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt die Aufgabe; allgemeine Abfragen bleiben standardmäßig sichtbar. Der Zusatznutzen gegenüber Verlauf und Ordnern bleibt für gemischte Bestände offen.

2. **ClickHouse-Abbruch verlässlich anzeigen.** Nach „Abbrechen“ soll klar sein, ob die Abfrage beendet oder der Abbruch nur angefordert ist. Ein [Superset-Commit vom 7. Oktober](https://github.com/apache/superset/commit/68a11500cfc54aa5136d81d6c04bc1e02f84422e) beschreibt falschen Erfolg; der bekannte l8db-Codehinweis passt dazu. Ein aktueller direkter Anwenderfall und ein l8db-Laufzeitbeleg fehlen.

3. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

[Neue Originalfälle und Existenzabgleich](sources.md#runde-18--fehler-einzelnen-skriptanweisungen-zuordnen) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Die offene Frage nach Navigation ohne deklarierte Fremdschlüssel prüfen: aktuelle Originalfälle und vorhandene lokale Beziehungsdefinitionen. Geschlossene Suchstränge nur mit neuem Ausgangsbeleg öffnen.
