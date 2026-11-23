# l8db · Ideenportfolio · 15. November 2026

**continuous-discovery-v3 · Fortlaufende Discovery.** 50 Vorschläge einschließlich bedingter Optionen; Karte 9 ergänzt A37 sowie bedingt A38 und die Peeroption A39, Karte 10 (ETag, Sorted-Set) bleibt ohne ID, Karte 11 ergänzt A40, Karte 12 ergänzt A41 und bedingt die Peeroption A42, Karte 13 (DynamoDB-Seiten) bleibt ohne eigene ID und ergänzt die Peeroption A43, Karte 14 ergänzt die Peeroption A44 und bedingt A45; das InfluxDB-Zeitfenster ist bereits offener Audit-Bug HTTP-20. Karte 15 ergänzt A46, Karte 16 bedingt A47. Frühere IDs bleiben einmalig integriert. Alle Vorschläge bleiben vorläufig, lokale Nachfrage und Nutzen sind ungemessen.

## Bisherige Kandidaten · unverändert

1. **Herkunft an gespeicherten SQL-Abfragen.** Verbindung und Datenbank sollen ähnlich benannte Abfragen in der bestehenden Liste unterscheidbar machen; allgemeine Abfragen bleiben sichtbar. Der [DbGate-Fall von 2026](https://github.com/dbgate/dbgate/issues/1377) stützt die Aufgabe, der Zusatznutzen gegenüber Verlauf und Ordnern bleibt für gemischte Bestände offen.

2. **ClickHouse-Abbruch verlässlich anzeigen.** Nach „Abbrechen“ soll klar sein, ob die Abfrage beendet oder der Abbruch nur angefordert ist. Ein [Superset-Commit vom 7. Oktober](https://github.com/apache/superset/commit/68a11500cfc54aa5136d81d6c04bc1e02f84422e) und der bekannte l8db-Codehinweis stützen den Vorschlag; ein aktueller direkter Anwenderfall und ein l8db-Laufzeitbeleg fehlen.

3. **SQL-NULL und JSON-null erhalten und unterscheiden.** Getrennte Wertarten sollen Anzeige und Filter verständlich machen. Der [bekannte MySQL-Bericht](https://github.com/beekeeper-studio/beekeeper-studio/issues/4732) und der statische MySQL-Codehinweis tragen den engen Vorschlag; unabhängige aktuelle Bestätigung fehlt.

## Zusätzliche Kandidaten · nach Arbeitspriorität

4. **A01 · PostgreSQL-Arrays typgerecht bearbeiten.** Elemente sollen ohne manuelles Escaping geändert werden können und ihre Grenzen beim Speichern behalten. Ein [direkter Bericht von 2026](https://github.com/dbeaver/dbeaver/issues/41082) zeigt das Kommaproblem; der Konkurrenzfehler ist behoben, ein gleicher l8db-Fehler nicht nachgewiesen und der vorhandene JSON-Editor bleibt berücksichtigt.

5. **A02 · Große JSON-Werte erst bei Bedarf vollständig laden.** Eine begrenzte Vorschau soll das Blättern ermöglichen, während das ganze Dokument gezielt geöffnet wird. [Aktuelle Freeze-Berichte](https://intellij-support.jetbrains.com/hc/en-us/community/posts/35309923017106-Database-Tool-laggy-and-freeze) stützen die Aufgabe; l8db hat bereits einen virtualisierten JSON-Baum, deshalb muss der Zusatz vor allem beim Laden liegen und ist lokal ungemessen.

6. **A03 · Schemaänderungen als verständlichen Bericht teilen.** Eine lesbare Liste geänderter Objekte soll die Abstimmung mit Personen erleichtern, die kein DDL lesen. Der [konkrete Wunsch](https://github.com/dbeaver/dbeaver/issues/19519) grenzt dies von vorhandenem SQL-/Snapshot-Export ab; er stammt von 2023 und belegt keine heutige Häufigkeit.

7. **A04 · Koordinatensystem bewusst übernehmen oder umstellen.** Die Kartenansicht soll das CRS des Werts verwenden und eine gewünschte Anzeigeprojektion nachvollziehbar machen. Der [Originalfall](https://github.com/dbeaver/dbeaver/issues/21190) beschreibt wiederholtes Korrigieren der Einstellung; l8db zeigt bislang Rohkoordinaten mit SRID, was für einfache Formprüfungen bereits genügt.

8. **A05 · Eigene Kartenhintergründe verwenden.** Geometrien sollen vor einer passenden fachlichen Karte statt nur einem Koordinatenraster eingeordnet werden können. Ein [direkter älterer Wunsch](https://github.com/dbeaver/dbeaver/issues/15255) trägt dies; DBeaver bietet die Funktion inzwischen, l8dbs Offlinekarte bleibt eine Alternative und CRS-Handhabung ist eine Abhängigkeit.

9. **A06 · Ergebnisse auf einem zweiten Monitor weiterführen.** Ein getrenntes Ergebnisfenster soll neue Läufe desselben Editors anzeigen, damit lange SQL-Texte und breite Tabellen gleichzeitig Platz haben. Der [Originalbericht](https://github.com/dbeaver/dbeaver/issues/34959) benennt diesen Ablauf ausdrücklich; App-Fenster und Split-Ansichten existieren in l8db, diese Kopplung wurde dort nicht gefunden.

## Zusätzliche bedingte Kandidaten · keine gesicherte Nachfrage

10. **A07 · Benannte Teilrollback-Marken im Transaktionspanel.** Nutzer könnten einen bewusst gesetzten Zwischenstand auswählen, statt Savepoint-Namen und Rücknahmesyntax selbst zu verwalten. Ein [behobener Konkurrenzfall](https://github.com/dbeaver/dbeaver/issues/35821) zeigt die Teilrollback-Aufgabe, fordert aber keinen solchen Manager; SQL-Savepoints und interner Fehlerschutz sind bereits vorhanden, der UI-Zusatz bleibt Hypothese.

11. **A08 · JSON-Zellunterschiede lesbar erklären.** Vorhandene Wertvergleiche könnten JSON formatiert und entlang seiner Pfade gegenüberstellen, statt lange einzeilige Werte zu zeigen. Bisher gibt es nur einen [Herstellerhinweis auf einen DataGrip-Wunsch](https://sqlly.app/blog/competitor-watch-2026-10-30); das verlinkte Original war nicht lesbar, daher schwache Evidenz und kein neuer Vergleichsmotor.

12. **A09 · Pläne vor der Weitergabe gezielt redigieren.** SQL-Literale und Objektbezeichnungen könnten ersetzt werden, während Planstruktur und Messwerte erhalten bleiben. [Vorhandene externe Weitergabewege](https://www.pgexplain.dev/) zeigen das Angebot, keinen Bedarfsnachweis; l8db warnt bereits und entfernt Zugangsdatenfelder, die weitere Redigierung bleibt bedingt.

13. **A10 · JSON gegen ein bekanntes Schema prüfen.** Ein zugeordnetes JSON-Schema könnte fehlende Pflichtfelder und falsche Werte vor dem Übernehmen am betroffenen Feld zeigen. [Ältere Compass-Fälle](https://feedback.mongodb.com/ideas/CUSTOMER-I-6820) beschreiben die Fehlersuche trotz Serverprüfung; [Compass zeigt Details inzwischen](https://www.mongodb.com/docs/compass/release-notes/2025/). Eine Schema-Zuordnung wurde im l8db-Editor nicht gefunden; die Übertragung auf bearbeitbare SQL-JSON-Zellen bleibt offen.

## continuous-discovery-v3 · Zusätzliche Kandidaten

14. **A11 · SQL-Literallisten kontrolliert übernehmen.** Eine erkennbare Liste wie `('A', 'B')` soll vor der Übernahme in den vorhandenen IN-Filter als einzelne Werte erscheinen. Ein [Bericht vom September 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4779) zeigt fehlende Treffer beim Wechsel zwischen Kopierformat und Filter; l8db bietet bereits Mehrfach-Paste und sicheres Quoting. Die Ergänzung wäre Formatübernahme mit Vorschau, ein gleicher lokaler Laufzeitfehler ist nicht nachgewiesen.

15. **A12 · Serverhinweise beim Grid-Speichern anzeigen.** Trigger-Hinweise und Warnungen sollen unmittelbar zur gespeicherten Grid-Änderung sichtbar werden, damit ein Erfolgstext fachliche Hinweise nicht verdeckt. Ein [älterer direkter DBeaver-Fall](https://github.com/dbeaver/dbeaver/issues/9174) benennt genau diesen Unterschied zur SQL-Ausführung und ist dort geschlossen. l8db erfasst Query-/Skriptmeldungen bereits; im geprüften Grid-Weg wurde kein entsprechender Abhol-/Anzeigeschritt gefunden, ohne Laufzeitprüfung.

## continuous-discovery-v3 · Zusätzlich bedingt

16. **A13 · Eine fachliche Anzeigezeitzone wählen.** Eine benannte Zone wie `America/New_York` könnte Umrechnen für mehrere Kundenregionen ersparen, wenn sie von UTC und Rechnerzeit abweicht. Ein [aktueller erfasster Nutzerwunsch](https://github.com/beekeeper-studio/beekeeper-studio/issues/4793) beschreibt solche Regionalarbeit, fordert zunächst aber lokale Anzeige, die l8db schon bietet. Der Bedarf einer dritten Zone ist daher eine begründete Hypothese; Eingabe und Rohwerte würden dadurch nicht automatisch umgerechnet.

17. **A14 · Fehlende IDs aus einer vorliegenden Liste finden.** Ein lesender Listenabgleich könnte zu angelieferten IDs Treffer und Nichttreffer zeigen, statt nur vorhandene Zeilen über IN zu filtern. Ein [direkter, aber sehr alter Arbeitsfall](https://stackoverflow.com/questions/10087287/sql-how-do-you-look-for-missing-ids) beschreibt eine Liste aus einer E-Mail und fehlende Rechte für eine Hilfstabelle. SQL-Joins, Import und l8dbs vorhandene Vergleiche bleiben Alternativen; eine bequeme Listenquelle ist nur bedingt vorgeschlagen, kein neuer Vergleichsmotor.

## Karte 2 · Neue Kandidaten

18. **A15 · Große Beträge lesbar formatieren.** Eine wählbare Spaltenanzeige mit Zifferngruppen und Dezimalstellen soll das Prüfen großer Beträge erleichtern, während der genaue Rohwert erhalten bleibt. Ein [Originalbericht von Juli 2026](https://github.com/dbeaver/dbeaver/issues/41489) beschreibt diese Lesearbeit; die Konkurrenz bietet Formatierung bereits und schloss den Fall ohne bestätigten Defekt. l8db schützt große Zahlen schon beim Transport, eine entsprechende Grid-Formatwahl wurde nicht gefunden.

19. **A16 · Prozedurergebnisse im Aufrufdialog zeigen.** Zurückgelieferte Werte sollen nach dem Aufruf sichtbar bleiben, damit „erfolgreich“ nicht die Antwort der Prozedur ersetzt. Ein [direkter Rückgabefall](https://github.com/dbeaver/dbeaver/issues/35477) beschreibt genau das; [Apache Hop hat einen verwandten Ablauf inzwischen ergänzt](https://github.com/apache/hop/issues/4858). Der l8db-Dialog zeigt bisher nur Dauer und Zeilenzahl; zunächst bereits gelieferte Ergebniszeilen nutzen, keine allgemeine OUT-/Cursor-Unterstützung versprechen.

20. **A17 · Effektive PostgreSQL-Objektrechte erklären.** Eine lesende Ansicht soll direkte Grants, geerbten Zugriff und erst nach Rollenwechsel verfügbare Rechte unterscheidbar machen. Ein [direkter älterer Wunsch](https://github.com/dbeaver/dbeaver/issues/2992) trägt die Aufgabe; l8db besitzt bereits Grant-Matrix und Mitgliedschaften, aber keine gefundene gemeinsame Effektivsicht. Das erklärt Objektzugang, beweist jedoch keine Sichtbarkeit einzelner RLS-geschützter Zeilen.

## Teamoptionen · zusätzlich bedingt

21. **A18 · Vorhandene DB-Kommentare durchsuchen.** Fachbegriffe aus Tabellen- und Spaltenkommentaren könnten in der normalen Objektsuche direkt zum passenden Objekt führen. Ein [historischer DataGrip-Wunsch](https://youtrack.jetbrains.com/issue/DBE-5245/) und ein [engerer aktueller Kommentarfall](https://youtrack.jetbrains.com/issue/DBE-27556) stützen die Aufgabe unterschiedlich stark. l8dbs Wissens-/KI-/MCP-Suche und Katalog-SQL bleiben Gegenwege; der Zusatz zur normalen Namenssuche ist lokal unvalidiert.

22. **A19 · Feste Anwendungscodes mit Bezeichnungen mitlesen.** Eine bewusst gepflegte Zuordnung könnte viele Statuswerte gleichzeitig als Code und Fachbegriff zeigen, ohne wiederholtes CASE oder Einzel-Nachschlagen. Ein [direkter alter Metabase-Fall](https://discourse.metabase.com/t/how-to-auto-mapping-constant-value-field-just-like-sql-case-when/3397) beschreibt diese Arbeit. FK-Vorschau, Label-Picker, Views und Glossar existieren bereits; nur Konstanten ohne Lookup-Tabelle sind der bedingte Zusatz.

23. **A20 · Berechnete Ergebnisspalten auf ihre Eingaben zurückführen.** Zusätzlich zur direkten Herkunft könnten auflösbare Ausdrücke ihre Eingabespalten und Transformationen zeigen und so das Rückwärtslesen über CTEs erleichtern. Ein [historischer technischer SQLLineage-Fall](https://github.com/reata/sqllineage/issues/531) belegt die verlangte Tiefe und ist behoben, kein aktueller Fachleserfall. l8dbs direkte Herkunft, SQL-/Viewdefinitionen und KI-Erklärung bleiben Gegenwege; der Zusatz ist schwach belegt und keine vollständige Herkunftsgarantie.

## Karte 3 · Zusätzliche Kandidaten

24. **A21 · Bei gleichen Sortierwerten stabil weiterblättern.** Ein bekannter eindeutiger Schlüssel könnte die gewählte Fachsortierung ergänzen, damit Zeilen an Seitengrenzen nicht wegen gleicher Sortierwerte wiederholt oder übergangen werden. Ein [DbGate-Bericht von August 2026](https://github.com/dbgate/dbgate/issues/1537) beschreibt die Such- und Kontrollarbeit, beweist aber diese Ursache nicht. l8db ordnet PostgreSQL-Seiten standardmäßig bereits nach Primärschlüssel; der Zusatz betrifft explizite Fachsortierung und garantiert keinen unveränderten Datenstand bei parallelen Änderungen.

25. **A22 · Breite Datensätze senkrecht lesen.** Eine Record-/Transposeansicht könnte Feldnamen und Werte untereinander zeigen und das wiederholte horizontale Suchen zusammengehöriger Felder ersparen. Ein [erfasster Nutzerablauf von September 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4796) beschreibt diesen Nutzen; das zitierte Reddit-Original ist dort nicht verlinkt. l8db bietet bereits Pinning, Spaltensuche, Einzelwertdialog und JSON-Kopieren; DBeaver hat die Ansicht schon, der lokale Zusatznutzen bleibt ungemessen.

## Neue Teamoption · bedingt

26. **A23 · Rückfragen an einer Notebookzelle festhalten.** Eine Frage könnte ausdrücklich an einer Analysezelle hängen, damit Fachleser und SQL-Person den Bezug zur besprochenen Annahme behalten. [Historische Originalinterviews](https://epiclab.github.io/publications/chi20-chattopadhyay.pdf) tragen die Feedbackaufgabe; ein [dokumentierter Reviewablauf](https://gist.github.com/jason-curtis/481d1921bc7d478b603e413e96cf0e2e) kam dagegen mit Kopie und Textnotizen aus. Markdownnotizen, Reviewkopien und stabile Zell-IDs existieren in l8db bereits; der Zusatz ist unvalidiert und kein neues Freigabe-/Teamprodukt.

## Karte 4 · Zusätzliche Kandidaten

27. **A24 · SQL-Dateien mit bewusst gewählter Kodierung öffnen.** Eine Kodierungswahl beim Öffnen oder Neuladen könnte fremde SQL-Texte lesbar machen, ohne sie erst in einem anderen Editor umzuwandeln. Ein [direkter historischer Dateifall](https://stackoverflow.com/questions/44796919/dbeaver-file-encoding-cp1250-windows-1250-change-default-encoding) beschreibt genau diese Arbeit; [DataGrip bietet den Weg bereits](https://www.jetbrains.com/help/datagrip/encoding.html). l8db liest schon UTF-8 mit Windows-1252-Fallback, andere Kodierungen sind der Zusatz; dessen lokale Nachfrage ist ungemessen.

28. **A25 · Beobachtungsbasis unbenutzter Indizes zeigen.** Bekannte Resetinformationen könnten beim vorhandenen Indexcheck sichtbar machen, wie vorsichtig ein niedriger Nutzungszähler einzuordnen ist. Eine [direkte Frage zum Beobachtungszeitraum](https://dba.stackexchange.com/questions/237489/are-idx-scan-statistics-reset-automatically-default) trägt die Aufgabe, stammt aber von 2019. l8db nennt Statistik-Reset und Replikas bereits; der zusätzliche Kontext bleibt bedingt und beweist weder vollständige Lastabdeckung noch einen sicheren Löschzeitpunkt.

## Neue Teamoption · bedingt

29. **A26 · Vorhandene Fachtexte bewusst für eine zweite Verbindung übernehmen.** Bereits gepflegte Tabellen-/Spaltentexte oder Glossarbegriffe könnten ausgewählt wiederverwendet werden, statt sie erneut einzutragen. Ein [Metabase-Fall von 2024](https://discourse.metabase.com/t/ability-to-copy-model-metadata-across-databases-with-identical-tables-and-columns/119685) belegt wiederholte Metadatenpflege trotz kopierbarer SQL, betrifft aber verschiedene Datenbanken und breitere Metadaten. Manuelle Textübernahme, zentrale DB-Kommentare und gemeinsame Doku bestehen; gleiche Fachbedeutung unter persönlichen l8db-IDs und der zusätzliche Nutzen sind unvalidiert, kein automatischer Abgleich.

## Karte 5 · Zusätzlich bedingt

30. **A27 · Laufende Indexerstellung nach Phasen lesen.** Native Bau-/Validierungsphasen und verfügbare Zähler im vorhandenen Monitor könnten zusätzliche Katalogabfragen ersparen, wenn Laufzeit und Wartegrund nicht reichen. Ein [Originalablauf von 2021](https://dba.stackexchange.com/questions/295203/how-to-find-progress-of-database-reindexing-on-postgresql) zeigt diese Prüfarbeit, verlangt allerdings auch Gesamtfortschritt mehrerer Indizes; ein [Supabase-Fall von 2025](https://github.com/supabase/supabase/issues/35040) zeigt die Grenzen stillstehender Prozentzahlen. Der lokale Zusatznutzen bleibt bedingt; keine Restzeitgarantie oder Lösung eines Serverstillstands.

31. **A28 · Sitzungsbezug temporärer SQL-Tabellen sichtbar machen.** Die Zuordnung zum bereits gebundenen Ausführungsweg könnte erklären, warum eine Zwischentabelle beim nächsten Aufruf verfügbar bleibt oder nach Sitzungsende fehlt. Ein [historischer VS-Code-Ablauf](https://www.reddit.com/r/SQL/comments/wr713g/) beschreibt eine fehlende Tabelle im selben Fenster, ein [DBeaver-Fall](https://stackoverflow.com/questions/76034575/error-after-second-read-from-cte-or-temporary-table-in-postgres) umgekehrt eine unerwartet fortbestehende Tabelle. Transaktions-/Skriptwege, Serverausgabesitzung und lokale Session-Views bestehen; zusätzlicher Orientierungsnutzen ist unvalidiert, keine neue Sessionengine oder Erhaltungsgarantie.

## Karte 6 · Zusätzliche Kandidaten

32. **A29 · Binärzellwerte bewusst als Text lesen.** Eine ausdrücklich gewählte Textdekodierung könnte wiederholte CAST-/CONVERT-Ausdrücke ersparen, wenn eine Binärspalte tatsächlich Text enthält. Ein [direkter Beekeeper-Wunsch vom August 2026](https://github.com/beekeeper-studio/beekeeper-studio/issues/4641) beschreibt genau diese Arbeit, während [DBeaver die Kodierungswahl bereits bietet](https://dbeaver.com/docs/dbeaver/Data-Editor-preferences/). l8db hat Hex, Base64 und ASCII schon; der zusätzliche Textmodus ist lokal ungemessen und keine automatische UUID-Deutung.

33. **A30 · Optionale Editor-Metadaten bewusst laden.** Eine Wahl je Verbindung könnte unerwünschte zusätzliche Katalogabfragen beim SQL-Arbeiten begrenzen, während ausdrücklich angeforderte Metadaten verfügbar bleiben. Ein [gelöster Snowflake-Clientfall von 2024](https://github.com/orgs/dbeaver/discussions/35905) trägt den Ablauf; ein [SQLFluff-Bericht von 2026](https://github.com/sqlfluff/sqlfluff/issues/8239) zeigt verwandte unnötige Vorabfragen beim Linten. l8db besitzt Caches und ein begrenzt abgedecktes SQL-Log, lädt Editorregister aber automatisch; lokaler Nutzen und Kostenwirkung bleiben ungemessen.

## Karte 6 · Zusätzlich bedingt

34. **A31 · Den Lesestand einer offenen SQL-Transaktion erklären.** Ein Bezug zum tatsächlich ermittelten Isolationslevel könnte verständlich machen, warum eine neu ausgeführte Abfrage ältere Fremdänderungen weiterhin nicht sieht. Ein [direkter DBeaver-Fall von 2017](https://github.com/dbeaver/dbeaver/issues/2035) wurde über den vorhandenen Transaktionsmodus gelöst; das ist keine aktuelle lokale Fehlerbestätigung. Commit/Rollback und Transaktionshinweise bestehen bereits, der zusätzliche Erklärnutzen bleibt bedingt; Startzeit oder Monitorstandard sind kein nachgewiesener Snapshotzeitpunkt.

35. **A32 · Den Stand einer materialisierten View mit Quelle einordnen.** Eine Viewansicht könnte einen verlässlich gelieferten Refreshstand oder dessen Unbekanntheit zeigen, damit Leser ihn vor Verwendung der Zahlen berücksichtigen. Ein [Reportfall von 2014](https://stackoverflow.com/questions/21166117/check-last-refreshed-time-for-materialized-view) trägt diese zusätzliche Leseraufgabe trotz funktionierendem Refresh; native Metadaten-SQL und dokumentierte Abläufe bleiben Gegenwege. Der lokale Zeitvertrag fehlt bisher und der Nutzen ist unvalidiert: Befüllung, Objektänderung und Refreshabschluss beweisen keine fachliche Aktualität, keine neue Protokoll-/Refreshengine.

## Karte 7 · Zusätzlich bedingt

36. **A33 · Gemischte Filter als zusammengehörige Gruppen lesen.** Eine lesende Gruppendarstellung könnte zeigen, auf welche ODER-Alternativen eine UND-Bedingung wirkt, ohne den Filter umzuschreiben. Ein [Esri-Originalablauf](https://community.esri.com/en/discussion/1700993/experience-builder-query-widget-sql-expression-builder-and-with-contains-not-working) beschreibt unerwartet breite Treffer und eine bestätigte Lösung mit vorhandenen Gruppen. l8db zeigt SQL und verweist gemischte Bedingungen ausdrücklich dorthin; der Zusatz für Leser ohne SQL-Routine bleibt eine unvalidierte Hypothese, keine neue Filterengine.

37. **A34 · Die Formatierung des eigenen SQL vor Übernahme vergleichen.** Ein Vergleich mit dem Original könnte bedeutungstragende Änderungen sichtbar machen, bevor der Editor sie übernimmt. Ein [aktueller Bericht zur verwendeten Formatterversion](https://github.com/sql-formatter-org/sql-formatter/issues/980) zeigt einen trotz gewähltem Dialekt veränderten Funktionsnamen; der Maintainer nennt erhaltene Schreibweise als Gegenweg. Dialektwahl, Auswahlformatierung, Beispielvorschau und Undo bestehen lokal bereits; ein zusätzlicher Prüfvergleich ist bedingt, kein ausdrücklich belegter Vorschauwunsch oder Nachweis gleicher SQL-Bedeutung.

## Karte 8 · Zusätzlich bedingt

38. **A35 · Die Basis relativer DuckDB-Dateipfade erkennen.** Eine Anzeige der tatsächlich verwendeten Pfadbasis könnte wiederholtes Prüfen und Umschreiben von Dateiverweisen zwischen CLI und Desktopclient ersparen. Ein [DBeaver-Wunsch von 2023](https://github.com/dbeaver/dbeaver/issues/21671) beschreibt diese Arbeit; [DuckDB bietet mit file_search_path bereits einen Gegenweg](https://duckdb.org/docs/2.0/data/overview). l8db löst Dateiöffnungen schon absolut auf, eine eigene Anzeige der SQL-Pfadbasis wurde nicht gefunden; deren Nutzen und verlässlicher lokaler Vertrag bleiben offen, keine automatische Verzeichnisänderung.

39. **A36 · Oracle-Textgrenzen mit ihrer Einheit anzeigen.** Die bekannte BYTE-/CHAR-Grenze könnte im vorhandenen Wertdialog stehen, damit mehrsprachige Eingaben mit dem passenden Maß geprüft werden. Ein [Herstellerfall von 2014](https://support.axway.com/en/articles/article-details/id/176081) zeigt einen Fehler trotz Zeichenzählung, betrifft jedoch Sentinel und keinen Desktopclientwunsch. DDL und präzise Serverfehler bestehen; Nutzen und lokaler Einheitenvertrag bleiben ungeprüft, keine automatische Kürzung oder Zusage, dass ein Text gespeichert werden kann.

## Karte 9 · Zusätzlicher Kandidat

40. **A37 · SQL-Server-Indexrollen vollständig lesen.** Die bestehende Indexansicht soll Schlüsselreihenfolge, mitgespeicherte INCLUDE-Spalten und bekannte Filter auseinanderhalten, damit eine vereinfachte Definition nicht als vollständig gelesen wird. Aktuelle Originalberichte zeigen eine [irreführende Spaltenreihenfolge](https://github.com/dbeaver/dbeaver/issues/42377) und [fehlende Filter](https://github.com/dbeaver/dbeaver/issues/41995). l8dbs geprüfter SQL-Server-Pfad führt diese Spalten zusammen und übernimmt den Filter nicht; native Katalog-SQL ist ein Gegenweg, lokales Laufverhalten und Nutzen bleiben ungemessen.

## Karte 9 · Zusätzlich bedingt

41. **A38 · Die Messgrenze der Abfragezeit kenntlich machen.** Die vorhandene Zeitangabe könnte erklären, ob sie Datenübernahme einschließt, damit sie beim Vergleichen nicht als reine Serverzeit gelesen wird. Ein [Wunsch von 2017 samt Konkurrenzfix](https://github.com/dbeaver/dbeaver/issues/1478) stützt die Unterscheidung; eine reine Kennzeichnung ist daraus nur abgeleitet. l8db hat Jobdauer und Planansichten bereits, misst im geprüften Queryweg einschließlich Ergebnisübernahme; zusätzlicher Erklärnutzen ist unvalidiert, keine neue Aufteilung in geschätzte Server-, Netz- oder Renderzeiten.

42. **A39 · ClickHouse-Einzelzustände bewusst finalisiert ansehen.** Eine wählbare Projektion in der bestehenden Tabellenvorschau könnte wiederholte SELECT-Ausdrücke ersparen, wenn Nutzer gespeicherte Aggregatzustände lesen wollen. Ein aktueller [Superset-Fall samt gemergtem Fix](https://github.com/apache/superset/issues/45791) belegt diese Vorschauarbeit; native SQL und kuratierte Views bestehen, der dortige Decoderfehler ist für l8db nicht nachgewiesen. Nur bedingt: Der lokale Ergebnisvertrag und Nutzen sind ungeprüft, und ein finalisierter Einzelzustand ist keine garantierte Gesamtkennzahl.

## Karte 11 · Zusätzlicher Kandidat

43. **A40 · SQL-Server-`timestamp` nicht als Zeitangabe einordnen.** Eine `timestamp`/`rowversion`-Spalte ist eine binäre Zeilenversion; l8db ordnet sie statisch per Typname als Datum ein und bietet dafür Zeitmarker und Datumsfilter an. Vier andere Werkzeuge hatten dieselbe Verwechslung, etwa [pgloader](https://github.com/dimitri/pgloader/issues/989) und [Visual Paradigm](https://forums.visual-paradigm.com/t/ms-sql-server-timestamp-columns-being-shown-as-datetime-in-visual-paradigm-erd/15597), und [Microsoft nennt den Wert ausdrücklich datums- und zeitlos](https://learn.microsoft.com/en-us/sql/t-sql/data-types/rowversion-transact-sql). Kein Fall aus einem Desktop-Grid, keine l8db-Laufzeitprüfung; enge Korrektur, keine Datumsumrechnung.

## Karte 12 · Zusätzlicher Kandidat

44. **A41 · Elasticsearch-Keyword-Grenze beim exakten Filtern kenntlich machen.** Werte über `ignore_above` stehen sichtbar im Dokument, fehlen aber im Keyword-Unterfeld, auf das l8db Gleichheitsfilter umleitet; der Filter findet sie still nicht. Drei Originale zeigen diesen Ablauf, etwa eine [`term`-Prüfung von 2021](https://discuss.elastic.co/t/is-there-any-character-limit-on-term-filter/279544) und ein [Kibana-Fall von 2024](https://discuss.elastic.co/t/the-value-in-this-field-is-too-long-and-cannot-be-searched-or-filtered/360699); Kibana markiert solche Werte bereits. Kein l8db-Laufzeitbeleg, und laut [Doku](https://www.elastic.co/docs/reference/elasticsearch/mapping-reference/ignore-above) entfällt die Grenze in spaltenorientierten Indexmodi ab 9.6.

## Karte 12 · Peeroption, bedingt

45. **A42 · Vektorvergleichsoperatoren beim Lesen erklären.** Ein Hinweis an pgvector-Operatoren wie `<=>` und `<#>` könnte Richtung und dokumentierte Umrechnung zeigen, damit eine Distanz nicht als Ähnlichkeit im falschen Bereich gelesen wird. Herkunft UR: [pgvector #814](https://github.com/pgvector/pgvector/issues/814) und [Chroma #1187](https://github.com/chroma-core/chroma/issues/1187) zeigen die Fehldeutung, aber in keinem Datenbankclient, und native Doku löst beide in einer Zeile. Laut PF sind Symboloperatoren im Editor kein Hover-Ziel, und Fachleser sehen die Zahl im Raster ohne Operatorkontext; bleibt bedingt, keine Nachfragevalidierung.

## Karte 13 · Peeroption

46. **A43 · Einfach aktualisierbare Views im Grid bearbeiten.** l8db sperrt Views im Grid grundsätzlich; wer Lookup-Werte über eine View pflegt, muss auf Basistabelle oder SQL ausweichen. Herkunft UR: [pgAdmin #2363](https://github.com/pgadmin-org/pgadmin4/issues/2363) (Wunsch 2019 und 2025, umgesetzt Oktober 2026) und [TablePlus #3952](https://github.com/TablePlus/TablePlus/issues/3952) (genutzte Funktion, 2026) tragen die Aufgabe. Schreibrisiko, Zeilenadressierung und lokaler Bedarf sind ungeprüft.

## Karte 14 · Peeroption

47. **A44 · Mitlaufende MySQL-Zeitstempel in den Spaltendetails kenntlich machen.** Die Spaltendetails zeigen `CURRENT_TIMESTAMP` als Default, aber nicht, dass die Spalte bei jeder Änderung mitläuft. Herkunft UR: [SO 18962757](https://stackoverflow.com/questions/18962757) beschreibt genau diese Verwechslung, [SO 54350419](https://stackoverflow.com/questions/54350419) eine ungefragt gesetzte Klausel bei älterem MariaDB. Die DDL-Ansicht zeigt sie schon, und beide Fälle sind alt.

## Karte 14 · Zusätzlich bedingt

48. **A45 · Aufbewahrungsdauer eines InfluxDB-Buckets beim Lesen sichtbar machen.** Wer ältere Punkte vermisst, muss außerhalb von l8db prüfen, ob die Aufbewahrungsdauer sie gelöscht hat. Ein [direkter Fall von 2023](https://community.influxdata.com/t/data-older-than-1-year/32152) beschreibt dieses Vermuten; die native Bucket-Einstellung zeigt die Dauer schon, und laut [Doku](https://docs.influxdata.com/influxdb/v2/reference/internals/data-retention/) löscht der Server zeitversetzt, also ohne scharfe Grenze.

## Karte 15 · Zusätzlicher Kandidat

49. **A46 · ClickHouse-Tabellen mit zusammenführender Engine beim Lesen kenntlich machen.** Bei ReplacingMergeTree, CollapsingMergeTree und verwandten Engines zeigen Vorschau und Zählung bis zum Hintergrund-Merge auch veraltete oder doppelte Zeilen, und l8db nennt die Engine nur in der DDL. Ein [DBeaver-Wunsch von 2026](https://github.com/dbeaver/dbeaver/issues/40080) verlangt genau diese Kennzeichnung, zwei Metabase-Fälle zeigen Bedarf an einer [`FINAL`-Sicht](https://github.com/metabase/metabase/issues/60602). Kein l8db-Fall, und `FINAL` kostet Leistung.

## Karte 16 · Bedingter Kandidat

50. **A47 · PostgreSQL-Tabellen mit `UNLOGGED` beim Lesen kenntlich machen.** Der Inhalt einer UNLOGGED-Tabelle fehlt nach einem Absturz und auf Replikas, l8db nennt die Eigenschaft aber nur in DDL und Schemavergleich. Ein [Backupfall von 2012](https://www.postgresql.org/message-id/DE2DE764-307D-4A23-A9A9-6608AC0977CB%40ticketevolution.com) und ein [vermeintlicher Datenverlust von 2021](https://www.postgresql.org/message-id/fabac0b6aff24e0d82e3871892f5b2cd%40bih-charite.de) zeigen Leser, die den Status nicht kannten. Alte Fälle, kein Clientwunsch gefunden.

[Aktuelle Aufgabenkarte und nächste Fragen](backlog.md#fortschritt--continuous-discovery-v3) · [Karte 9 und Teamabgleich](sources.md#continuous-discovery-v3--karte-9) · [Karte 11](sources.md#continuous-discovery-v3--karte-11) · [Karte 12](sources.md#continuous-discovery-v3--karte-12) · [Karte 13](sources.md#continuous-discovery-v3--karte-13) · [Karte 14](sources.md#continuous-discovery-v3--karte-14) · [Karte 15](sources.md#continuous-discovery-v3--karte-15) · [Karte 16](sources.md#continuous-discovery-v3--karte-16). Alte Einzelprüfungen und Reserven bleiben Historie; sie wurden nicht neu gezählt. Keine Implementierungszusage.
