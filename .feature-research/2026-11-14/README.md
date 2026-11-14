# l8db · Forschungsentscheidung · 14. November 2026

**Nach Runde 3: Exportumfang und Verbindungsdiagnose behalten; vollständigen Importcheck nur bedingt weiterverfolgen.** Die bestehenden Wege können bereits viel; der Nutzen liegt in gezielten Ergänzungen.

1. **Exportumfang eindeutig festhalten.** Vorhandene Auswahl, geladene Teilmenge und erneute Datenbankabfrage sollen auch beim Wiederverwenden einer Aufgabe unterscheidbar bleiben. Ein [DBeaver-Bericht aus Juni 2026](https://github.com/dbeaver/dbeaver/issues/41281) beschreibt den Wechsel von Auswahl zu ganzer Tabelle nach dem Speichern; l8db hat Loaded-/Full-Export und Kürzungswarnungen bereits, ein separater Exportbeleg ist bisher nicht ausreichend begründet.

2. **Verbindungsfehler im Zusammenhang erklären.** Bereits bekannte Fehler sollen der passenden Stufe wie Agent, SSH oder TLS zugeordnet werden, damit Nutzer nicht an der falschen Stelle suchen. Ein [TablePlus-Fall aus September 2026](https://github.com/TablePlus/TablePlus/issues/3950) zeigt eine irreführende Passwortabfrage bei unerreichbarem Agent; inzwischen behoben, und l8db hat diesen konkreten Agentfehler schon verständlich benannt, daher ist nur die zusammenhängende Diagnose neu.

3. **Optionaler CSV-Gesamtcheck ohne Schreiben.** Er würde auch hinter der Vorschau liegende Format-/Typfehler vor dem Import sammeln und wiederholte Fehlversuche verkürzen. l8db prüft Zuordnung/NULL-Werte schon; [Beekeeper dokumentiert fehlende automatische Typprüfung](https://docs.beekeeperstudio.io/user_guide/importing-data-csv-json-etc/), doch die aktuelle Nachfrage nach einem Vollcheck ist unbewiesen und Server-/Treiberfehler löst er nicht.

**Widerlegt/eingegrenzt:** Die Trennung von Teilmenge und neuer Abfrage ist kein fehlendes Konkurrenzfeature: [DBeaver](https://github.com/dbeaver/dbeaver/wiki/Data-export), [TablePlus](https://tableplus.com/docs/getting-started) und [DataGrip](https://www.jetbrains.com/help/datagrip/export-data.html) dokumentieren unterschiedliche Exportumfänge. Ein Abschlussbeleg beweist weder vollständige Daten noch unveränderte Werte. Keine der drei Ideen ist ein belegtes Alleinstellungsmerkmal.

[Neue Evidenz und Grenzen](sources.md#runde-3--gegenprüfung-der-drei-führenden-ideen) · [Backlog](backlog.md). Frühere Konzepte und visuelle Artefakte bleiben unverändert als historischer Stand erhalten; diese kurze Entscheidung hat Vorrang.

**Nächste offene Frage:** Verlieren l8db-Nutzer tatsächlich den beabsichtigten Exportumfang, oder genügen vorhandene Beschriftungen? Für den Vollcheck fehlen Fälle mit mehreren späten Dateifehlern; Zahlungsbereitschaft und Häufigkeit sind weiterhin unbekannt. Diese Runde umfasst nur Recherche und Notizen, keine visuellen Arbeiten, Tests oder Produktänderungen.
