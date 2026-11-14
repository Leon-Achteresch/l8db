# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 5: Verbindungsdiagnose vor Spaltenexport. Die Exporthypothese bleibt schwach; der Exportbeleg bleibt zurückgestellt.**

1. **Verbindungsinformationen zusammenführen.** Ein gemeinsamer Überblick über Agent, SSH und Datenbank könnte die Suche an der falschen Fehlerstelle verkürzen. Ein [TablePlus-Bericht von 2026](https://github.com/TablePlus/TablePlus/issues/3950) belegt das Problem, ist inzwischen behoben; l8db hat schon präzise Einzelmeldungen. Sinnvoll bleibt nur ergänzender Zusammenhang, dessen konkreter Bedarf noch zu prüfen ist.

2. **Spaltenansicht in eine Datei übernehmen.** Sichtbare Spalten samt Reihenfolge zu übernehmen könnte erneutes Zusammenstellen vor der Übergabe sparen. l8db kann die Ansicht schon kopieren und XLSX-Spalten manuell auswählen. Ein [Tabularis-Maintainerwunsch vom Oktober 2026](https://github.com/TabularisDB/tabularis/issues/1299) betrifft nur Auswahl-Export; zusätzlicher Bedarf in l8db bleibt schwach belegt.

3. **Mehrere CSV-Dateifehler vor dem Import sammeln.** Ein schreibfreier Sammellauf könnte wiederholtes Korrigieren und Starten vermeiden. Der passende [Originalbericht von 2022](https://github.com/duckdb/duckdb/issues/4193) ist alt, und [DuckDB bietet die Fehlersammlung bereits](https://duckdb.org/docs/2.0/data/csv/reading_faulty_csv_files). Aktuelle Nachfrage nach einer geführten l8db-Integration bleibt offen; deshalb nachrangig.

[Quellen und Codeabgleich aus Runde 5](sources.md#runde-5--sichtbare-spalten-reihenfolge-und-vorhandene-kopierwege) · [Backlog](backlog.md). Frühere Artefakte bleiben erhalten; diese Entscheidung hat Vorrang.

**Nächster Fokus:** Ein unabhängiger Dateiexportfall, bei dem Kopieren und manuelle XLSX-Spaltenwahl nicht genügen.
