# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 11: Herkunft ist unabhängig aktuell gestützt; der gemischte Bestand bleibt offen. Zwei konkrete Prüfkandidaten, Kindtabellenfilter schwächer belegt.**

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnliche Namen unterscheidbar machen; allgemeine Abfragen bleiben standardmäßig sichtbar. Ein [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt das Zuordnen, verknüpft Filter aber mit fester Zielbindung. Für gemischte Bestände bleibt der Zusatznutzen gegenüber Verlauf und Ordnern offen; der [direkte Mischfall](https://github.com/beekeeper-studio/beekeeper-studio/issues/3105#issuecomment-3139408487) stammt von 2025.

2. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

3. **Über Kindtabellen filtern – nachrangig.** Eine eindeutige Elternliste soll direkt nach Werten aus Kindtabellen filterbar sein. Der JOIN-Builder bietet den Suchweg bereits; zum [bisherigen Supportwunsch](https://github.com/beekeeper-studio/beekeeper-studio/issues/5055) fehlt unabhängige aktuelle Bestätigung.

[Neue Evidenz und Gegenprüfung](sources.md#runde-11--allgemeine-und-spezifische-abfragen) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Wiederherstellung älterer Fassungen gespeicherter Abfragen: direkte Nutzerfälle und vorhandene l8db-Funktionen prüfen.
