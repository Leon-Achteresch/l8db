# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 4: Exportidee auf den Erhalt der Ansicht eingrenzen; keine zusätzliche allgemeine Full-/Loaded-Erklärung empfehlen. Exportbeleg bleibt zurückgestellt.**

1. **Bewusster Ansichtsexport.** Eine übernehmbare Spaltenauswahl würde verhindern, dass für die Übergabe ausgeblendete Spalten wieder in der Datei auftauchen; l8dbs Full-/Loaded-Wahl beantwortet diese Frage noch nicht. Ein [DataGrip-Originalfall vom Oktober 2025](https://youtrack.jetbrains.com/issue/DBE-24561) belegt unerwartet ungefilterte Dateien trotz gefilterter Vorschau; die Übertragung auf Spaltenausblendung ist eine engere Hypothese, keine bewiesene l8db-Beschwerde.

2. **Verbindungsinformationen zusammenführen.** Agent-, SSH- und Datenbankfehler im Zusammenhang zu erklären könnte die Suche an der falschen Stelle verkürzen. Viele Einzelmeldungen existieren schon; der Kandidat bleibt unverändert auf Platz 2, ohne neue Diagnose-Evidenz aus dieser exportbezogenen Runde.

3. **Mehrere CSV-Fehler vorab sammeln – nachrangig.** Ein [DuckDB-Nutzerbericht von 2022](https://github.com/duckdb/duckdb/issues/4193) nennt viele Quote-Fehler, einen Fehler bei Zeile 9.556 und wiederholte Korrekturläufe. Das stützt die konkrete Aufgabe, aber [DuckDB kann fehlerhafte Zeilen inzwischen sammeln](https://duckdb.org/docs/2.0/data/csv/reading_faulty_csv_files); aktuelle Nachfrage nach einer geführten l8db-Funktion bleibt offen, ein neuer allgemeiner Prüf-Parser ist damit nicht begründet.

**Gegenprüfung:** Der schon bekannte DBeaver-Aufgabenfall von 2026 bleibt ein Beleg für Umfangsverlust beim Speichern, kein zusätzlicher unabhängiger Fall. l8db übergibt Tabellenfilter bereits an den Full-Export und berücksichtigt lokale Ergebnissuche beim Kopieren; neue allgemeine Filter-/Auswahlfunktionen wären teilweise Dubletten. Diese Runde ergab keinen weiteren verifizierten 2026-Fall, der zusätzliche Beschriftungen gegenüber diesen vorhandenen l8db-Funktionen rechtfertigt.

[Neue Quellen und Codeabgleich](sources.md#runde-4--umfangsverlust-trotz-vorschau-und-mehrere-späte-csv-fehler) · [Backlog](backlog.md). Frühere Artefakte bleiben unverändert; diese kurze Entscheidung hat Vorrang.

**Nächster Fokus:** Gibt es einen direkten aktuellen Bericht über den Wiederexport ausgeblendeter Spalten oder einen unerwarteten Wechsel von Auswahl zu Vollumfang? Beim CSV-Check nur weitere Originalfälle mit mehreren späten Dateifehlern zählen. Keine neuen visuellen Arbeiten, Tests, Produktspezifikationen oder Produktänderungen in dieser Runde.
