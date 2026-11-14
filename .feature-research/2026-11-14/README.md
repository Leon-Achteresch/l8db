# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 13: Herkunft bleibt vorn. ClickHouse-Abbruchstatus kommt als enger Prüfkandidat hinzu; Kindtabellenfilter bleibt nachrangig im Backlog.**

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnliche Namen in der bestehenden Liste unterscheidbar machen. Der [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt die Aufgabe; allgemeine Abfragen bleiben standardmäßig sichtbar. Der Zusatznutzen gegenüber Verlauf und Ordnern bleibt für gemischte Bestände offen.

2. **ClickHouse-Abbruch verlässlich anzeigen.** Nach „Abbrechen“ soll klar sein, ob die Abfrage beendet oder der Abbruch nur angefordert ist. l8db meldet im geprüften Pfad bereits nach dem Stoppauftrag „abgebrochen“, obwohl [dieser laut Doku nicht auf das Ende wartet](https://clickhouse.com/docs/reference/statements/kill). Die Lücke ist statisch gestützt; ein beobachteter l8db-Laufzeitfall fehlt.

3. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

[Neue Evidenz und Gegenprüfung](sources.md#runde-13--bewusster-abbruch-und-clickhouse-status) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Unabhängige aktuelle Fälle einer falschen Erfolgsmeldung nach ClickHouse-Abbruch; ohne neue Fundstelle keine Treibervertiefung.
