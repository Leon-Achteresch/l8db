# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 16: Herkunft bleibt vorn. MySQL-Zellkonflikte ergänzen die Liste als vierter, noch schwächer belegter Kandidat.**

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnliche Namen in der bestehenden Liste unterscheidbar machen. Der [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt die Aufgabe; allgemeine Abfragen bleiben standardmäßig sichtbar. Der Zusatznutzen gegenüber Verlauf und Ordnern bleibt für gemischte Bestände offen.

2. **ClickHouse-Abbruch verlässlich anzeigen.** Nach „Abbrechen“ soll klar sein, ob die Abfrage beendet oder der Abbruch nur angefordert ist. Ein [Superset-Commit vom 7. Oktober](https://github.com/apache/superset/commit/68a11500cfc54aa5136d81d6c04bc1e02f84422e) beschreibt falschen Erfolg; der bekannte l8db-Codehinweis passt dazu. Ein aktueller direkter Anwenderfall und ein l8db-Laufzeitbeleg fehlen.

3. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

4. **Fremdänderungen beim Speichern erkennen.** Ein MySQL-Zellwert soll nicht still überschrieben werden, wenn ihn seit dem Laden jemand geändert hat. Ein [aktueller Rechnungsapp-Bericht](https://www.reddit.com/r/Backend/comments/1vhx6zz/how_do_you_actually_handle_two_people_editing_the/) und der statische l8db-Abgleich stützen den Nutzen. Ein direkter Datenbankclient-Fall und ein l8db-Laufzeitbeleg fehlen.

[Neue Evidenz und vorhandener Schutz](sources.md#runde-16--fremdänderungen-beim-zellenspeichern) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Einen direkten aktuellen Datenbankclient-Fall für denselben Zellkonflikt prüfen; ohne passenden Fund keine weitere Vertiefung. ClickHouse, NULL und Wechselverlust bleiben ohne neuen Ausgangsbeleg geschlossen.
