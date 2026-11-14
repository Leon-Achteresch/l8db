# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 10: SQL-Herkunft bleibt vorn, eng auf die vorhandene Liste begrenzt. Zwei konkrete Prüfkandidaten; der dritte bleibt schwächer belegt.**

1. **Gespeicherte SQL-Abfragen nach Herkunft finden.** Verbindung und Datenbank sollen in der vorhandenen Liste sichtbar und bei Bedarf filterbar sein. Ein [DBeaver-Wunsch von 2026](https://github.com/dbeaver/dbeaver/issues/42275) und ein [Beekeeper-Fall von 2025](https://github.com/beekeeper-studio/beekeeper-studio/issues/3105) beschreiben das Problem ähnlicher Namen; der Verlauf bietet den Kontext bereits für frühere Ausführungen. Allgemeine Abfragen bleiben übergreifend erreichbar; der Zusatznutzen gegenüber Ordnern ist noch offen.

2. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten machen unterschiedliche Filterergebnisse verständlich. Ein [MySQL-Bericht vom September 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der bisherige statische l8db-Codeabgleich sprechen für eine Lücke vor der Anzeige; nur andere Beschriftungen reichen deshalb nicht. [SQLly beschreibt die Trennung bereits](https://sqlly.app/blog/competitor-watch-2026-10-19); ein zweiter aktueller Originalfall zur gleichen Anzeigeverwechslung fehlt.

3. **Über Kindtabellen filtern – nachrangig.** Ein solcher Filter könnte Nutzer anhand einer E-Mail-Adresse in ihrer Adresstabelle finden. Der JOIN-Builder kann den Suchweg bereits abbilden; der Zusatz wäre die eindeutige Elternliste direkt in der Tabellenansicht. Zum [bisherigen Supportwunsch](https://github.com/beekeeper-studio/beekeeper-studio/issues/5055) wurde kein unabhängiger aktueller Nutzerfall gefunden.

[Neue Evidenz und Gegenprüfung](sources.md#runde-10--gespeicherte-abfragen-und-vorhandene-kontextwege) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Aktuelle Nutzerfälle mit allgemeinen und verbindungsspezifischen Abfragen im selben Bestand; den Nutzen optionaler Zuordnung prüfen.
