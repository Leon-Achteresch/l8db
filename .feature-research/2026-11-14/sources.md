# Evidenzregister

Abrufdatum aller Quellen: **2026-11-14**. Direkte öffentliche Seiten gelesen; keine privaten Produktdaten oder Secrets verwendet. Aussagen sind qualitative Einzelfallbelege, keine repräsentative Marktforschung. Geschlossene Issues belegen historische Aufgaben, keine weiterhin bestehende Konkurrenzlücke.

## Runde 1

- S01: DBeaver [#39884](https://github.com/dbeaver/dbeaver/issues/39884), 2025-12-05, geschlossen, Meilenstein 25.3.4. Nutzer konnte vorhandene Exportfunktion ohne erneute Abfrage nicht finden und schlägt eine explizite Wahl zwischen Speicher und neuer Abfrage vor. Stark für dieses konkrete UX-Problem; keine Aussage zur Häufigkeit.
- S02: DBeaver [#37214](https://github.com/dbeaver/dbeaver/issues/37214), 2025-02-17, offen beim Abruf. Bericht: Vertica-Export endet bei Timeout mit unvollständiger Datei ohne klare Fehlermeldung. Mittlere Evidenz für Abschluss-/Vollständigkeitsbeleg, nicht lokal reproduziert.
- S03: DBeaver [#36452](https://github.com/dbeaver/dbeaver/issues/36452), 2024-12-04, geschlossen mit Verweis #36459. BigQuery→Excel: nur 1.048.575 Datenzeilen trotz höherem eingestelltem Limit. Mittlerer historischer Beleg für sichtbare Formatgrenzen.
- S04: TablePlus [#3809](https://github.com/TablePlus/TablePlus/issues/3809), 2026-04-01, geschlossen 2026-06-25. SSH funktioniert im Terminal, Timeout im Client; Nutzer verweist auf nicht unterstützte Config-Optionen. Maintainer meldet SSH 12 hinzugefügt. Stark für historischen Diagnosebedarf, kein Beweis eines aktuellen TablePlus-Fehlers.
- S05: Beekeeper Studio [#1949](https://github.com/beekeeper-studio/beekeeper-studio/issues/1949), 2024-02-12, offen. Manuell erstellter Tunnel funktioniert, eingebauter scheitert mit Auth-/Handshake-Fehlern. Kommentare 2025: ursprünglicher Autor kann aktuellen Fehler nicht mehr bestätigen. Mittlerer Beleg, technisch teilweise unklar.
- S06: Beekeeper Studio [#4739](https://github.com/beekeeper-studio/beekeeper-studio/issues/4739), 2026-09-09. Bericht über hängende RPC-Anfragen nach Verbindungsverlust, mit konkreten Codeverweisen. Primäre URL geöffnet; Status und aktuelle Auflösung werden in Runde 2 separat geprüft. Technische Erklärung ist die des Reporters, nicht unabhängig verifiziert.
- S07: TablePlus Windows [#774](https://github.com/TablePlus/TablePlus-Windows/issues/774), 2026. Sammelbericht: FK-Quick-Look hinterlässt Filter, Session-/Filterwiederherstellung und mehrere UX-Wünsche. Seite enthält Nachtrag zu inzwischen umgesetzten Punkten. Einzelne Aussagen getrennt prüfen; kein pauschaler Feature-Gap.
- S08: DBeaver [#6854](https://github.com/dbeaver/dbeaver/issues/6854), 2019. Virtuelle Fremdschlüssel gehen nach Wiederöffnen des Projekts verloren. Historischer, schwacher Nachfragebeleg; zeigt gleichzeitig, dass virtuelle Beziehungen am Markt existieren.
- S09: DBeaver [Discussion #34262](https://github.com/orgs/dbeaver/discussions/34262), 2024-06-05, beantwortet 2024-06-07. Teilmenge von Produktion nach Staging gesucht; Export über Query-Ergebnis löst die Aufgabe. Beleg für Auffindbarkeit, kein Beleg für ein fehlendes Transferfeature.
- S10: TablePlus Windows [#734](https://github.com/TablePlus/TablePlus-Windows/issues/734), 2025-04-30, geschlossen. Unterschiedliche MySQL-Zeitzonen werden als Restorefehler wahrgenommen; Autor bestätigt falsche lokale Serverzeitzone. Gegenbeleg gegen pauschale Restore-Bug-Behauptung. l8db-Zeitanzeige existiert bereits.

## Runde 2 · Gegenprüfung und neue Originalbelege

| ID | Quelle / Datum | Aufgabe und beobachtete Aussage | Aktualität / Stärke / Grenze |
|---|---|---|---|
| S11 | [Beekeeper #4468](https://github.com/beekeeper-studio/beekeeper-studio/issues/4468), 2026-07-06 | XLSX-Import korrigieren: statt ursprünglichem Fehler erscheint nur Transaktionsabbruch | Offen, zuletzt geändert am Eröffnungstag; mittel, konkreter Symptombericht, keine unabhängige Reproduktion |
| S12 | [Beekeeper #4888](https://github.com/beekeeper-studio/beekeeper-studio/issues/4888), 2026-10-21 | Kleine XLSX-Datei in SQL Server importieren: Spinner bleibt stehen, Fehlerdetails nur in DevTools | Offen, zuletzt geändert am Eröffnungstag; mittel; über Support erfasster Bericht, referenziert S11 und ist daher kein vollständig unabhängiger zweiter Beleg |
| S13 | [Reddit: Not all rows importing from csv?](https://www.reddit.com/r/dbeaver/comments/1di0fko/not_all_rows_importing_from_csv/), 2024-06 (Suchindex; Tag nicht separat bestätigt) | CSV nach MySQL: nach übersprungenem ungültigem Integer fehlen laut Autor Zeilen trotz weiterlaufendem Zähler | Direkt gelesen; mittel–schwach, unabhängiger Nutzer, keine abschließende technische Auflösung; kein pauschaler DBeaver-Datenverlustbeweis |
| S14 | [DataGrip: Virtual foreign keys](https://www.jetbrains.com/help/datagrip/virtual-foreign-keys.html), laufende Doku 2026.3 | Lokale Beziehungen ohne Änderung des Datenbankcodes; Speichern in externen Metadaten | Direkt gelesen; stark für existierendes Wettbewerbsangebot, schwach als Nachfragebeleg; Gegenbeleg gegen Einzigartigkeit |
| S15 | [DBeaver: Data compare](https://github.com/dbeaver/dbeaver/wiki/data-compare), bearbeitet 2026-09-17 | Tabellen und SELECT-Ergebnisse vergleichen, vorhandene Grid-Zeilen oder neue Ausführung | Direkt gelesen; stark für existierende Funktion, keine Nachfrage-Messung. Doku warnt vor nicht geladenen Zeilen. Enterprise/Ultimate |
| S16 | [DBeaver: Data Search](https://github.com/dbeaver/dbeaver/wiki/Data-Search), bearbeitet 2026-09-17 | Find-in-results prüft nur bereits geladene Zeilen | Direkt gelesen; Eingrenzung einer Funktion, ausdrücklich kein Beleg, dass DBeaver keine datenbankweite Suche hat |
| S17 | [Beekeeper: Troubleshooting](https://docs.beekeeperstudio.io/support/troubleshooting/), laufende Doku | Diagnose verlangt DevTools/Logs; erklärt Verbindungsfehler nach IP-Allowlist-Ablauf | Direkt gelesen; Herstellerwissen, keine unabhängige Beschwerde. Bestätigt mögliche unterschiedliche Ursachen |
| S18 | [TablePlus #3397](https://github.com/TablePlus/TablePlus/issues/3397), 2024-09-24 | FK-Navigation soll editierbare strukturierte Filter statt Raw-SQL-Filter erzeugen | Offen, zuletzt geändert am Eröffnungstag; konkreter Wunsch; nicht gleichbedeutend mit Nachfrage nach virtuellen Beziehungen |

### Statuskorrekturen aus der öffentlichen GitHub-API

Metadaten ohne Issue-Bodies, Autorenprofile oder Anhänge gespeichert in [source-status.json](source-status.json). Abgerufen am 2026-11-14. `updated_at` kann administrative Änderungen enthalten und beweist keine neue Nutzeraktivität.

| Quelle | Eröffnet | Letzte API-Änderung | Status / Abschluss |
|---|---|---|---|
| S01 #39884 | 2025-12-05 | 2026-07-03 | Geschlossen 2026-01-23. Die Konkurrenz hat die UX-Aufgabe bearbeitet |
| S02 #37214 | 2025-02-17 | 2026-07-07 | Offen; tatsächliches Fortbestehen nicht nachgetestet |
| S03 #36452 | 2024-12-04 | 2026-07-03 | Geschlossen 2024-12-05 |
| S04 #3809 | 2026-04-01 | 2026-06-25 | Geschlossen 2026-06-25; Maintainer nennt neue SSH-Version |
| S05 #1949 | 2024-02-12 | 2025-02-02 | Offen; Autor kann Symptom 2025 nicht bestätigen |
| S06 #4739 | 2026-09-09 | 2026-09-16 | Offen; zwei Kommentare; Root-Cause-Aussage bleibt Reporterinterpretation |
| S07 #774 | 2026-02-10 | 2026-08-14 | Offen, Sammelbericht mit erledigten Teilwünschen |
| S08 #6854 | **2019-09-28** | 2025-02-28 | **Bereits 2019-10-04 geschlossen**; spätes Metadatum macht den Bericht nicht aktuell |
| S10 #734 | 2025-04-30 | 2025-05-03 | Geschlossen; Konfigurationsursache statt nachgewiesenem Restorefehler |

### Was die Gegenprüfung verändert hat

- **Export bleibt Rang 1**, aber als nachvollziehbare Weiterentwicklung vorhandener l8db-Funktionen. Die Konkurrenzlücke ist keine offene „Export ohne Re-run“-Lücke mehr. S01 schließt eine Neuheitsbehauptung aus.
- **Diagnose bleibt Rang 2**, automatische Wiederherstellung wird aus dem MVP gestrichen: bestehendes l8db-Tunnel-Reconnect und Zeitlimits nicht duplizieren. S06 darf nicht als Beweis für denselben Tauri-Fehler behandelt werden; Beekeeper nutzt eine andere Prozessarchitektur.
- **Import steigt auf Rang 3** durch S11–13. Die konkrete Lösung „kompletter lokaler Prüflauf“ ist unsere Hypothese, keine wörtliche Forderung dieser Nutzer. S12/S11 werden nicht als zwei unabhängige Kundenstimmen gezählt.
- **Lokale Beziehungen sinken auf Rang 4**: S08 ist alt und gelöst, S14 zeigt etabliertes Angebot. Zusätzlicher aktueller Nutzerbeleg fehlt. Daher kein priorisiertes drittes Beziehungs-Mockup.
- **Zeitzonenanzeige, Cloud-Login und Planvergleich verworfen**: direkt im Code vorhanden. S10 stützt höchstens Kontextdiagnose.
- **Keine Konkurrenzpauschalen aus Reddit**: Release-Ankündigungen sind keine originalen Beschwerden; allgemeine „bester Client“-Threads wurden nicht als Nachfrage gezählt. Spiegel-Domains aus Suchergebnissen wurden durch direkte GitHub-URLs ersetzt und für zentrale Issues per API geprüft.

## Recherchegrenzen

Drei Hauptkonkurrenten mit Originalberichten: DBeaver, TablePlus, Beekeeper Studio; DataGrip zusätzlich als Angebots-/Gegenbeleg. GitHub ist deutlich überrepräsentiert; englischsprachige technische Nutzer, keine zahlenden l8db-Kundenstichprobe. Offene Issues sind kein Beleg für aktuelle Reproduzierbarkeit. Keine Stimmen-/Sterneanzahl als Marktgröße verwendet. Vier Ideen im unteren Backlog besitzen bewusst nur angrenzende oder herstellerseitige Evidenz.

Öffentlicher l8db-Roadmap-Release `https://api.github.com/repos/Leon-Achteresch/l8db/releases/tags/roadmap` lieferte **404** am Abrufdatum, einmal geprüft, ohne Retry. Das beweist nur, dass dort kein öffentlich abrufbarer Feed vorlag. Lokale dokumentierte Roadmap und tatsächlicher Code wurden getrennt betrachtet.

## Ergänzende Gegenbelege am Ende von Runde 2

- **S19 · Herstellerbeteiligung erkennen:** [Reddit: konzeptionelle Fremdschlüssel](https://www.reddit.com/r/PostgreSQL/comments/1tk2yiw/how_do_you_handle_foreign_keys_that_exist/), 2026, Seite zeigt beim Abruf „5mo ago“; genaues Tagesdatum nicht bestätigt. Autor legt Jam-SQL-Beteiligung offen. Er stellt fehlende klickbare Beziehungen zunächst auch für DataGrip/DBeaver dar, bestätigt nach Einwand jedoch deren virtuelle FKs. **Kein unabhängiger Nachfragebeleg** und keine verlässliche Konkurrenzlücken-Aussage. Stärkt das Zurückstellen von Idee 4.
- **S20 · Direkte Suchaufgabe:** [Reddit: Search all tables for a specific term](https://www.reddit.com/r/SQL/comments/13dzzlz/search_all_tables_for_a_specific_term/), 2023 laut Suchindex, genaues Tagesdatum nicht bestätigt. Nutzer sucht uneinheitliche Begriffe über unbekannte Felder/Tabellen in GIS-Datenbanken; Kommentare unterscheiden Wert- und Spaltennamensuche. Historischer Originalfall, mittlere Evidenz für diese Aufgabe, schwach für heutige Nachfrage. Idee 7 bleibt wegen Scanrisiko und fehlender aktueller l8db-Bestätigung niedrig priorisiert.
- **S21 · Eigengebauter Workaround:** [PostgreSQL needle in a haystack](https://gist.github.com/danielleevandenbosch/8e6b3817067f924385f7bd5b7b666fcc), zuletzt aktiv 2023-11-13. Öffentlicher Autor bietet ein Skript zur Suche in kleinen Tabellen bei bekanntem Muster. Verwandter Original-Workaround, keine Produktbeschwerde; verstärkt den Bedarf an explizitem Größen-/Tabellenscope. Skript nicht ausgeführt oder übernommen.

## Runde 3 · Gegenprüfung der drei führenden Ideen

Abruf **2026-11-14**. Neue Berichte direkt auf GitHub einschließlich Antworten gelesen; keine Konkurrenzsoftware ausgeführt. „Originalbericht“ bedeutet nicht automatisch unabhängiger zahlender Kunde; Reporterzugehörigkeit wurde nicht separat bestätigt. Keine Roh-Bodies/Anhänge gespeichert. Die GitHub-API lieferte im Verlauf Rate-Limit-403; keine Warte-/Retry-Schleife, Status daher aus den direkt lesbaren Seiten statt neuem API-Snapshot. Die ältere `source-status.json` bleibt unverändert.

### Heutige Konkurrenzabläufe

- **S22 · DBeaver:** [aktuelle Exportdoku](https://github.com/dbeaver/dbeaver/wiki/Data-export), bearbeitet 2026-10-20, trennt neue Datenbankabfrage, geladene Zeilen und Auswahl ausdrücklich. [PR #39998](https://github.com/dbeaver/dbeaver/pull/39998) ist gemergt. Starker Gegenbeleg gegen eine fehlende Quellenwahl; Doku allein beweist nicht, dass Nutzer sie verstehen.
- **S23 · TablePlus / DataGrip:** [TablePlus-Einstieg](https://tableplus.com/docs/getting-started) unterscheidet ganze Tabellen und „Export current page“; [Query-Ergebnisdoku](https://api.tableplus.com/docs/query-editor/working-with-query-results) beschreibt den eigenen Ergebnispfad. [DataGrip](https://www.jetbrains.com/help/datagrip/export-data.html) unterscheidet vollständigen Dateiexport von Kopieren der aktuellen Auswahl/Seite und bietet ein Query-Blatt für XLSX. Laufende Herstellerdokumentation, stark für vorhandene Abläufe; keine Nachfrage nach zusätzlichem Beleg daraus ableiten.
- **S24 · Beekeeper:** [Exportdoku](https://docs.beekeeperstudio.io/user_guide/data-export/) beschreibt Ergebnisdownload, vollständigen Download und gestreamten Tabellenexport. Die dort genannten 20.000 Ergebniszeilen widersprechen den 50.000 in der [Editor-Doku](https://docs.beekeeperstudio.io/user_guide/sql_editor/editor/); deshalb keine aktuelle numerische Grenze behaupten. Beide belegen schon vorhandene unterschiedliche Exportwege.

### Neue Originalfälle und Gegenbelege

| ID | Quelle / Datum / Status | Zusatznutzen für die Entscheidung |
|---|---|---|
| S25 | [DBeaver #41281](https://github.com/dbeaver/dbeaver/issues/41281), 2026-06-10, offen; Kommentar des Maintainers vom selben Tag | Nach Speichern als Aufgabe wird die ganze Tabelle statt ausgewählter Zeilen/Spalten exportiert. Maintainer erklärt dies als erwartetes Verhalten, weil Aufgaben die geladenen Zeilen nicht bewahren, und schlägt eine Warnung vor. Konkreter starker Beleg für verständlichen Umfang **beim Speichern**, kein Beleg für Belegdatei oder einen gleichartigen l8db-Fehler. |
| S26 | [TablePlus #3955](https://github.com/TablePlus/TablePlus/issues/3955), 2026-10-08, am selben Tag geschlossen; Fix laut Maintainer in Build 818 | Gzip-Export endet mitten in Daten; CSV funktioniert. Belegt tatsächliche Exportintegritätsprobleme, aber ein Metadatenbeleg hätte die defekte Kompression nicht verhindert. Kein fortbestehender Konkurrenzfehler behauptet. |
| S27 | [TablePlus #3950](https://github.com/TablePlus/TablePlus/issues/3950), 2026-09-29, geschlossen 2026-10-24; [#3938](https://github.com/TablePlus/TablePlus/issues/3938), 2026-09-16, geschlossen 2026-10-25 | Erster Fall: unerreichbarer Agent erzeugt irreführenden Passwort-/Keyfehler; zweiter: generischer SQLite-over-SSH-Fehler trotz erfolgreicher Shellprüfungen. Verschiedene Reporter, beide laut Maintainer behoben. Gute Aufgabenbelege für Fehlerzuordnung, kein Beweis einer umfassenden Diagnoseprodukt-Nachfrage. |
| S28 | [DBeaver #42290](https://github.com/dbeaver/dbeaver/issues/42290), 2026-10-02, geschlossen 2026-11-09 nach ausstehenden Rückfragen | Nutzer berichtet falsch zugeordnete CSV-Werte, Downgrade hilft; Maintainer konnte zunächst nicht reproduzieren. Geschlossen ist hier kein nachgewiesener Fix. Ein Vollscan mit derselben falschen Zuordnung kann dieselbe Ursache teilen; daher schwacher Beleg für schreibfreien Dateicheck. |
| S29 | [DBeaver #42812](https://github.com/dbeaver/dbeaver/issues/42812), 2026-11-10, offen | Import erzeugt leere Tabelle und scheitert mit „user public does not exist“ im gemeldeten Redshift-/Foundry-Setup. Aktueller Originalfall, aber kein lokaler CSV-Typfehler: Gegenbeleg gegen die Annahme, ein schreibfreier Dateicheck löse aktuelle Importprobleme generell. |
| S30 | [Beekeeper-Importdoku](https://docs.beekeeperstudio.io/user_guide/importing-data-csv-json-etc/), laufend | Vorschau: zehn Zeilen; für vorhandene Tabellen ausdrücklich keine automatische Prüfung der Dateitypen. Belegt einen möglichen Funktionsunterschied, jedoch keinen Nutzerwunsch nach vollständigem Vorabscan. |
| S31 | [DBeaver #42407](https://github.com/dbeaver/dbeaver/issues/42407), 2026-10-14, offen beim Abruf | Laut Reporter verlieren geladene Grid-Zeilen beim SQL-Export die Zeitzone; neue Abfrage erhält sie. Umfang, zeitlicher Stand und Werterhaltung sind verschiedene Fragen. Ein Beleg mit korrekter Zeilenzahl beweist keine korrekte Werteübertragung. |

### Erneute Codeprüfung: Was wäre in l8db tatsächlich neu?

Referenz `c4262c5b`, nur gelesen. Kein graphify-Graph vorhanden; wie im ersten Zyklus direkte Prüfung der relevanten Pfade, keine Installation oder Generierung.

- **Export:** `src/features/export/csv-export-dialog.tsx` und `data-export-dialog.tsx` nennen geladene Zeilenzahl, bieten bereits „Alle gefilterten Zeilen exportieren“, Limit und Streaminghinweis. Die Hooks melden `truncated`. Neu wäre höchstens die konsistente Erläuterung des Umfangs und eines möglichen Wechsels bei Wiederverwendung; **kein fehlender Full-/Loaded-Exporter**. Ein eigener Beleg bleibt unbelegte Zusatzannahme.
- **Diagnose:** `src-tauri/src/db/ssh/auth.rs` unterscheidet bereits Agent nicht erreichbar, keine Schlüssel, Signatur abgelehnt und Authentifizierung abgelehnt. `driver_repair.rs` plus Treiberansicht haben bereits eine eigene Treiberdiagnose. `test-result-status.tsx` zeigt Gesamtresultat/Dauer/Meldung; eine zusammenhängende Route mit Stufen ist der verbleibende Zusatz, nicht „endlich verständliche SSH-Fehler“.
- **Import:** `src/lib/csv-import/mapping.ts` prüft Zuordnung, Pflicht-/generierte Spalten und NULL in den vorliegenden Zeilen; `use-csv-import.ts` benutzt Preview-Daten. `csv-import-panel.tsx` zeigt Datensatz/Spalte/Originalfehler, `db/import.rs` lokalisiert Schreibfehler und meldet unbestätigten Commit. Neu wäre nur der vollständige schreibfreie Scan jenseits der Vorschau; **weder verständlicher Erstfehler noch Mappingprüfung fehlen grundsätzlich**.

**Verdichtung:** Exportumfang bleibt zuerst, ein separater Beleg wird zurückgestellt. Diagnose bleibt als kleine Verbindung vorhandener Informationen sinnvoll. Vollständiger Importcheck sinkt von „ausarbeiten“ auf „Nachfrage prüfen“: keine neue verifizierte Forderung nach diesem exakten Ablauf gefunden; Server-/Treiberfälle und bereits vorhandene l8db-Prüfungen schwächen die frühere Begründung. Keine Marktgröße, Zahlungsbereitschaft oder echte l8db-Fehlerrate abgeleitet.
