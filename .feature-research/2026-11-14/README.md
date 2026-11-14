# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 6: Drei Prüfideen, keine Hochstufung. Auch die Verbindungsübersicht braucht einen belegten Zusatznutzen; der Exportbeleg bleibt zurückgestellt.**

1. **Verbindungsinformationen zusammenführen.** Ein Überblick über Agent, SSH und Datenbank könnte Rückfragen bei der Fehlersuche sparen. Der [neue TablePlus-Fund mit Bericht vom November 2026](https://github.com/TablePlus/TablePlus/issues/3717) betrifft laut Reporter fehlerhaftes TLS-Verhalten des Treibers. Ein Zusatznutzen gegenüber l8dbs präzisen Fehlermeldungen bleibt unbelegt.

2. **Spaltenansicht in eine Datei übernehmen.** Sichtbare Spalten samt Reihenfolge zu übernehmen könnte erneutes Zusammenstellen vor der Übergabe sparen. l8db kann die Ansicht schon kopieren und XLSX-Spalten manuell auswählen. Ein neuer unabhängiger Bedarfsfall für diese Ergänzung fehlt; die Hypothese bleibt schwach.

3. **Mehrere CSV-Dateifehler vor dem Import sammeln.** Ein schreibfreier Sammellauf könnte wiederholtes Korrigieren und Starten vermeiden. Die bisherige Evidenz bleibt alt, [DuckDB bietet die Fehlersammlung bereits](https://duckdb.org/docs/2.0/data/csv/reading_faulty_csv_files). Aktuelle Nachfrage nach einer geführten l8db-Integration bleibt ungeklärt; unverändert nachrangig.

[Neue Gegenbelege und vorhandene Funktionen](sources.md#runde-6--dateiaufgabe-und-zusatznutzen-gegenprüfen) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Originalfälle, in denen eine Verbindung besteht, aber das tatsächliche Ziel oder der TLS-Zustand geklärt werden muss.
