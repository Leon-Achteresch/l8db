# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 9: Reihenfolge unverändert. Zwei konkrete Prüfkandidaten; der dritte bleibt schwächer belegt.**

1. **Gespeicherte SQL-Abfragen mit Herkunft.** Verbindung und Datenbank an gespeicherten Abfragen erleichtern die Auswahl ähnlicher Skripte. Ein [direkter Nutzerwunsch vom Oktober 2026](https://github.com/dbeaver/dbeaver/issues/42275) stützt die Aufgabe; l8db hat diesen Kontext bereits im Verlauf, aber nicht bei benannten gespeicherten Abfragen. Wie häufig die Ergänzung gebraucht wird, bleibt offen.

2. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten machen unterschiedliche Filterergebnisse verständlich. Ein [MySQL-Bericht vom September 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der bisherige statische l8db-Codeabgleich sprechen für eine Lücke vor der Anzeige; nur andere Beschriftungen reichen deshalb nicht. [SQLly beschreibt die Trennung bereits](https://sqlly.app/blog/competitor-watch-2026-10-19); ein zweiter aktueller Originalfall zur gleichen Anzeigeverwechslung fehlt.

3. **Über Kindtabellen filtern – nachrangig.** Ein solcher Filter könnte Nutzer anhand einer E-Mail-Adresse in ihrer Adresstabelle finden. Der JOIN-Builder kann den Suchweg bereits abbilden; der Zusatz wäre die eindeutige Elternliste direkt in der Tabellenansicht. Zum [bisherigen Supportwunsch](https://github.com/beekeeper-studio/beekeeper-studio/issues/5055) wurde kein unabhängiger aktueller Nutzerfall gefunden.

[Neue Evidenz und Gegenprüfung](sources.md#runde-9--null-bedeutung-und-anzeige-trennen) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Unabhängige Fälle zur Auswahl gespeicherter SQL-Abfragen nach Datenbank suchen; NULL vorerst eng halten.
