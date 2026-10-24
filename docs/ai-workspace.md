# KI-Arbeitsbereich

Status: Für `development` implementiert und mit Regressionstests geprüft. Noch keine Veröffentlichung.

Der separate Arbeitsbereich liegt in `/Users/leon/l8db-ai` auf `feature/ai-workspace`, ausgehend von `41b05088`. Vor dem abschließenden Merge wurde der aktuelle `development`-Stand im Feature-Worktree integriert und geprüft. Die Haupt-Arbeitskopie wurde während der Umsetzung erhalten.

## Verhalten

Der AI-Button links vor MCP im App-Header öffnet rechts einen kompakten KI-Arbeitsbereich neben der Datenbank. Gespräche behalten ihren Provider, Modell, Arbeitsordner und Verlauf. CLI-Anbindungen verwenden bestehende Anmeldungen und native Konfigurationen. BYOK-Anbindungen speichern Schlüssel im Betriebssystem-Schlüsselspeicher.

Unterstützte CLI-Protokolle: Codex App Server, Claude Code bidirektionales Stream-JSON, Gemini CLI ACP, OpenCode ACP, GitHub Copilot ACP. Die Benutzeroberfläche zeigt die Möglichkeiten des jeweiligen Adapters und übernimmt verfügbare Modelle und Modi aus dem nativen Protokoll. Fehlende oder inkompatible Programme führen zu verständlichen Fehlern. Installation und Anmeldung bleiben beim jeweiligen CLI.

BYOK: OpenAI und kompatible Chat-Completions-Endpunkte, Anthropic Messages und Google Gemini. Modelllisten werden beim Provider abgefragt; eigene Modellnamen sind möglich. Antworten und Tool-Aufrufe werden gestreamt, laufende Anfragen können abgebrochen werden.

Die aktuell offene Verbindung ist standardmäßig das Hauptziel, unabhängig von der Freigabe für den externen MCP-Server. `@` ergänzt ausdrücklich ausgewählte Verbindungen. Geheimnisse und Verbindungs-URLs werden nicht als Modellkontext übertragen. Tunnel müssen bereits verbunden sein; es gibt keinen Direktverbindungs-Fallback. Der Kontext wird je Anfrage eingefroren und beim nächsten Turn neu aufgelöst.

Interne Tools verwenden denselben Dispatcher wie der bestehende MCP: Suche, Tabellenbeschreibung, Abfragen, Ausführung, Dashboards und Benchmarks. Maskierungen, Begrenzungen, Schema-Beschränkungen, Read-only-Einstellungen und Produktionsschutz bleiben erhalten. Schreibzugriffe benötigen eine konkrete Freigabe im KI-Arbeitsbereich. Ein vom Modell gesetztes `confirm=true` ersetzt keine Benutzerfreigabe.

Native Skills und MCPs bleiben in der CLI-Konfiguration verfügbar. Zusätzlich lassen sich Skills gezielt aus `SKILL.md` auswählen und externe MCP-Server über Stdio oder Streamable HTTP für BYOK verbinden. Externe Tools benötigen eine ausdrückliche Freigabe pro Aufruf. Keine Ausführung über eine interpolierte Shell.

## Für Einsteiger

Antworten richten sich an Menschen ohne SQL-Kenntnisse. Das Modell soll zuerst in einfachen Worten antworten und Listen, Rankings, Verläufe und Aufteilungen über das Tool `visualize` zeigen. `visualize` führt eine Leseabfrage über denselben Weg wie `query` aus (maximal 500 Zeilen, Standard 200) und l8db zeigt das Ergebnis als Diagramm oder Tabelle im Chat. Die Karte lässt sich zwischen Diagramm und Tabelle umschalten, als CSV oder Excel speichern und als SQL in einem Abfrage-Tab öffnen. Normale `query`-Aufrufe zeigen in der Werkzeugzeile das ausgeführte SQL und das Ergebnis als Tabelle mit denselben Aktionen.

Nach einer Datenfrage beendet das Modell seine Antwort mit einem Codeblock `followups`. l8db zeigt daraus klickbare Anschlussfragen unter der letzten Antwort und lässt den Block beim Kopieren und Exportieren weg. Ein leerer Chat bietet Beispielfragen an, die aus den Tabellennamen der aktiven Verbindung abgeleitet werden (ohne Modellaufruf). Gespräche lassen sich im Verlauf als Markdown exportieren.

Zugang: ⌘J öffnet und schließt den Assistenten. In der Befehlspalette erscheint zu jeder Eingabe der Eintrag „KI fragen“, der die Eingabe direkt an den Chat schickt.

## Einrichtung

Der Einrichtungsassistent bietet drei Wege: CLI-Agent, eigener API-Schlüssel und lokales Modell (Ollama unter `http://localhost:11434/v1`, LM Studio unter `http://localhost:1234/v1`, beide über die OpenAI-kompatible Schnittstelle ohne Schlüssel). Lokale Anbieter gelten als eingerichtet, solange ihr Server auf `GET /models` antwortet. Am Ende schickt der Assistent eine echte Testanfrage („Antworte nur mit dem Wort OK.“). So fallen fehlende Anmeldung, ungültige Schlüssel, fehlendes Kontingent und nicht geladene Modelle sofort auf. Dieselbe Prüfung steht in den Einstellungen als „Verbindung testen“ bereit. Die Testanfrage kostet bei bezahlten Anbietern wenige Token.

Ohne gewähltes Modell wählt l8db bei API-Anbietern ein aktuelles Chatmodell aus der Modellliste (OpenAI: neuestes `gpt-*-mini`, Anthropic: neuestes Sonnet, Google: neuestes Gemini Flash, lokal: erstes Modell ohne Embedding). Der zuletzt gewählte Anbieter bleibt über Neustarts erhalten. Ist er nicht eingerichtet, ein anderer aber schon, wechselt der Chat beim Öffnen einmalig dorthin.

## Dateien anhängen

CSV, TSV, Excel, JSON, NDJSON und Parquet lassen sich über das Plus-Menü anhängen oder auf das KI-Panel ziehen. Das Ablegen außerhalb des Panels öffnet Dateien wie bisher. l8db liest Spalten, erkannte Typen, Zeilenzahl und die ersten 20 Zeilen mit den Import-Parsern und gibt sie dem Modell als Kontext mit. Anhänge bleiben an der Nachricht und gelten für das ganze Gespräch (höchstens zehn).

Das Tool `import_file` legt aus einem Anhang immer eine neue Tabelle an und lädt alle Zeilen über den vorhandenen Dateiimport. Es fragt jedes Mal nach einer Freigabe, auch im Modus „Alles automatisch“, und ist für schreibgeschützte, als Produktion markierte und Plan-Modus-Verbindungen gesperrt. Bestehende Tabellen werden nie verändert. Spaltentypen schlägt das Modell im Dialekt der Zieldatenbank vor; ohne Angabe wird Text verwendet. Typen sind auf Buchstaben, Ziffern, Leerzeichen, Klammern, Komma und Unterstrich beschränkt.

## Workflows

Das Tool `workflow` gibt der KI und dem externen MCP volle Kontrolle über die Automatisierung: Workflows auflisten, lesen, anlegen, ändern (auch einzelne Schritte über `add_step`, `update_step`, `remove_step`), duplizieren, löschen, aktivieren, pausieren, ausführen, abbrechen sowie Läufe und deren Details abfragen. `step_types` liefert dem Modell das komplette Format für Schritte, Abläufe, Zeitpläne und Variablen. Änderungen, die neue Validierungsfehler einführen, werden mit den Fehlern abgelehnt, damit das Modell sie korrigiert.

Das Tool `open` zeigt Dinge live im l8db-Fenster: Tabelle öffnen, Filter setzen oder entfernen (`filter`, WHERE-Bedingung, serverseitig wie der einfache Filter validiert), Filter als benannte Ansicht speichern (`saveAs`) oder SQL in einem neuen Editor-Tab öffnen (`sql`, wird nicht ausgeführt). Der MCP-Prozess hängt die Anfrage an `mcp-open.jsonl` neben `mcp.json`; das Hauptfenster holt sie jede Sekunde ab (`mcp_take_open_requests`), Anfragen älter als 60 s verfallen. Tab und Tabelle leuchten kurz neon auf (`AiFlash neon`). Tool-Beschreibung und System-Prompt erlauben den Aufruf nur, wenn die Anfrage das Öffnen, Anzeigen, Filtern oder Speichern ausdrücklich verlangt oder klar impliziert.

Im KI-Arbeitsbereich fragt jede Änderung und jeder Lauf nach einer Freigabe. Im Modus „MCP automatisch“ gehen Änderungen ohne Rückfrage durch, außer sie betreffen Schritte vom Typ Shell, HTTP, Restore, Datagen, Entpacken, Aufräumen, Datei verschieben oder Datei löschen. Im Plan-Modus sind Änderungen gesperrt. Für externe KI-Clients ist das Tool erst sichtbar, wenn unter MCP › Übersicht „KI-Clients dürfen Workflows steuern“ eingeschaltet ist. Workflow-Schritte laufen mit den Rechten der Automatisierung, Masken und Read-only-Freigaben des MCP gelten dort nicht.

Jede Aktion landet im Aktivitätsprotokoll der Automatisierungsdatenbank (Schlüssel `ai_activity`, die letzten 50 Einträge). Jedes Fenster fragt es alle zwei Sekunden ab, bei Änderungen aus der App sofort. Neue Einträge laden die Tasks neu und lassen die betroffene Task-Zeile sowie die geänderten Schritte in Liste und Graph kurz zweimal aufblinken. Ist in der Automatisierung gerade kein Task geöffnet, öffnet l8db den zuletzt geänderten Workflow. Bei reduzierter Bewegung blendet das Overlay einmal weich ein und aus.

## KI-Wissen

Pro Verbindung speichert l8db Notizen, ein Glossar und Beschreibungen für Tabellen und Spalten in `ai-knowledge.json` im Konfigurationsordner. Im Systemprompt stehen nur Notizen, ein kurzes Glossar und die Datenregeln der ausgewählten Verbindungen, als Hinweis und nicht als Anweisung gekennzeichnet, dazu ein Satz, wie viele Tabellen beschrieben sind. Tabellen- und Spaltenbeschreibungen holt sich das Modell bei Bedarf: `search` durchsucht sie und die Glossarbegriffe, `describe` hängt sie an Tabellen und Spalten, `overview` nennt die Abdeckung. Das gilt auch für externe MCP-Clients; die Zuordnung läuft über die Verbindungs-ID. Beschreibungen werden wie Kommentare maskiert. Es lässt sich im Plus-Menü unter „KI-Wissen“ bearbeiten. „Mit KI erzeugen“ startet ein Gespräch, in dem das Modell alle Tabellen ansieht und die Beschreibungen über das Tool `knowledge` speichert. Das Tool fragt im Modus „Immer fragen“ vor dem Speichern und ist im Plan-Modus gesperrt.

## Prüfung

Akzeptanz umfasst Provider-Protokolle einschließlich Fehlern und Abbruch, Kontextauswahl und Tunnelfehler, restriktive Zusammenführung von Richtlinien, echte Datenbankabfragen an synthetischen SQLite-Daten, Tool-Freigaben, Provider-Streaming mit lokalen HTTP-Fixtures, externe MCP-Verbindungen, Persistenz ohne Schlüssel sowie Bedienprüfung der Island in der App. Live-Modellanfragen setzen verfügbare Konten oder API-Schlüssel voraus und werden separat vom deterministischen Testumfang ausgewiesen.

Fünf unabhängige E2E-Prüfer haben echte native CLI-, App- und HTTP-Abläufe untersucht. Codex, Claude Code, OpenCode und GitHub Copilot bestanden jeweils zwei Turns mit SQLite-Abfragen und erneut aufgelöstem Verbindungskontext. Die native App-Prüfung las zusätzlich zwei ausdrücklich ausgewählte Datenbanken und wechselte eine laufende Sitzung zwischen Panel und vollständiger Seite. Gemini CLI initialisierte ACP, konnte ohne vorhandene Anmeldung aber keine echte Modellsitzung starten. BYOK wurde mit einem tatsächlichen lokalen HTTP/SSE-Provider und SQLite einschließlich erlaubter und abgelehnter Schreibzugriffe geprüft; kostenpflichtige externe API-Konten wurden nicht live geprüft.

Die BeUI-Regressionsprüfung läuft unter der Produktions-CSP in Chromium und WebKit und umfasst native Auswahlfragen, freie Antworten und Schemafelder, Tool-Freigaben, Abbruch, SQL-Code, Pläne, Diffs, Bilddaten, Herkunft, Verlauf nach Reload sowie Resize und Portalwechsel. Unbekannte Quellen und ungültige oder übergroße Bilddaten werden nicht als ausführbare Inhalte behandelt.

Die abschließenden Checks bestanden mit 1.944 Frontend-Tests, 546 Rust-Tests und je drei Produktions-Browserprüfungen in Chromium und WebKit. Build, Produktionskonfiguration, Frontend-Lint, Rust-Formatierung und Clippy einschließlich Test-Targets wurden geprüft. Umgebungsabhängige Tests bleiben separat: 206 Frontend-Tests und 138 Rust-Tests waren ohne aktiviertes Lab beziehungsweise Live-Provider übersprungen. Tabellenantworten rendern mit Spaltenüberschriften und horizontalem Scrollen; escaped Pipes, unvollständige Backticks und Code-Spans mit mehreren Backticks sind durch Parser- und Browserregressionen abgedeckt.

Die Abschlussprüfung nach Integration von `development` bestätigte die echten Zwei-Turn-Abläufe von Codex, Claude Code und GitHub Copilot erneut. OpenCode initialisierte ACP und die Sitzung erfolgreich, sein voreingestelltes Modell `opencode/big-pickle` scheiterte jedoch mit einem Provider-API-Fehler. Eine separate Anfrage ohne MCP und ohne Tools reproduzierte denselben Fehler. Der zuvor erfolgreiche OpenCode-Ablauf ersetzt diese aktuelle Einschränkung nicht.

## Referenzen

Die Adapter-Trennung orientiert sich an [T3 Code](https://github.com/pingdotgg/t3code/tree/main/apps/server/src/provider). Weitere Protokollreferenzen: [Codex App Server](https://developers.openai.com/codex/app-server), [Claude Code](https://code.claude.com/docs/en/cli-reference), [Gemini ACP](https://geminicli.com/docs/cli/acp-mode/), [OpenCode ACP](https://opencode.ai/docs/acp/), [Copilot ACP](https://docs.github.com/en/copilot/reference/copilot-cli-reference/acp-server), [Agent Client Protocol](https://agentclientprotocol.com/protocol/v1/session-setup).

## Oberfläche und UX

AI öffnet über den Button links vor MCP im App-Header. Das kompakte Panel lässt sich an seiner linken Kante mit Maus oder Tastatur skalieren; Datenbank-Shell und Panel bilden getrennte, vollständig abgerundete Flächen. Die vollständige Seite `/ai` bietet Gespräch, Verlauf, Kontext und Einstellungen. Beim Wechsel bleibt dieselbe Chat-Instanz mit der laufenden Sitzung erhalten.

Das Redesign folgt [Hick’s Law](https://lawsofux.com/hicks-law/) mit weniger gleichzeitigen Entscheidungen und [Progressive Disclosure](https://www.nngroup.com/articles/progressive-disclosure/): native Optionen, Tool-Details und Nutzungsdetails öffnen erst bei Bedarf. [Jakob’s Law](https://lawsofux.com/jakobs-law/) unterstützt die vertraute Chat-Struktur; [Proximity](https://lawsofux.com/law-of-proximity/) gruppiert Kontext am Composer; [Fitts’s Law](https://lawsofux.com/fittss-law/) begründet greifbare Bedienelemente und Resize-Ziele. Fragen verwenden native Auswahlmöglichkeiten und passende Formularfelder. Eine MCP-Freigabe ohne Eingabefelder benötigt kein JSON.

Visuelle Recherche: [Inspora](https://www.inspora.design/), [Refero Styles](https://styles.refero.design/) und [Collect UI](https://collectui.com/). Bestehende l8db-Typografie und Themes bleiben die Grundlage.

## BeUI-Agent-Komponenten

Die [17 Komponenten der BeUI-Agent-Sammlung](https://beui.dev/components/agents) werden aus der offiziellen Registry als angepasster Quellcode im Feature installiert. Die [offizielle Anleitung](https://beui.dev/docs/ai-agents) unterstützt diesen direkten Registry-Zugriff einschließlich Abhängigkeiten. Globale l8db-Primitives und bestehende Motion-Komponenten werden dabei nicht überschrieben. Die MIT-Lizenz und Quellenzuordnung liegen beim eingebundenen Feature-Code.

| BeUI-Komponente | Einsatz |
| --- | --- |
| Message Bubble | Oberflächen für gesendete Nachrichten |
| Message | Nachrichtengruppen und Absender |
| Message Scroller | Leseposition und Folgen des laufenden Streams |
| Prompt Input | Composer, Tastatur, Senden und Stoppen |
| Todo List | Native Pläne aus Codex und ACP |
| Code Block | SQL und andere Codeblöcke in Antworten |
| Approval Card | Rückfragen, native Auswahloptionen und Formulare |
| File Diff | Tatsächlich gemeldete Dateidiffs aus CLI- und MCP-Ergebnissen |
| Tool Result | Einklappbare Tool-Ausgaben |
| Streaming Response | Laufende und abgeschlossene Antworten |
| Image Generation | Tatsächlich gelieferte Bilddaten aus CLI oder MCP |
| Tool Approval | Freigabe für genau einen Aufruf oder Ablehnung |
| Citations | Datenbankherkunft und explizit gelieferte Quellen |
| Agent Activity | Zusammengefasste Tool-Aktivität und sichtbarer Fortschritt |
| Agent Loading States | Tatsächlicher Start-, Lade- und Laufstatus |
| AI Sidebar | Navigation im Gesprächsverlauf |
| Chat App | Komposition der vollständigen AI-Seite |

Die Gruppe Agent Loading States wird über die drei offiziellen Registry-Einträge `reasoning-text`, `thinking-shimmer` und `agent-progress` installiert. Rich-Ergebnisse bleiben an die tatsächlich gelieferten Provider-Daten gebunden. Es werden keine Bild- oder Suchaufträge simuliert. Ein nativer Dateipfad allein löst keinen Dateizugriff aus. Quellen benötigen keine extern geladenen Favicons; die bestehende CSP bleibt erhalten. Freigaben bieten einmaliges Erlauben und Ablehnen, keine globale Berechtigungsübernahme.

CLI-Sicherheitsmodi gelten pro Anfrage. Codex startet und setzt Sitzungen mit Read-only-Sandbox und konservativen Freigaben fort; der Plan-Modus erlaubt keine Sandbox- oder Berechtigungserweiterung. Claude verwendet explizit den normalen Freigabemodus beziehungsweise Plan. ACP repariert übernommene Umgehungsmodi nur mit vom CLI angebotenen sicheren Optionen und bricht sonst vor dem Prompt ab. Native Konfigurationsdateien und Anmeldungen werden dabei nicht geändert. Plan sperrt Datenbank- und Dashboard-Änderungen serverseitig; gewöhnliche Dashboard-Änderungen benötigen eine eigene Freigabe. Ein freigegebenes lokales Dashboard kann Abfragen einer Read-only-Datenbank darstellen, ohne deren Schreibschutz zu ändern.

Die Live-Prüfung erfolgte auf macOS. Unix beendet beim Abbruch die gesamte CLI-Prozessgruppe. Unter Windows wird derzeit der direkte CLI-Prozess beendet; der Abbruch sämtlicher möglicher Kindprozesse ist noch nicht live verifiziert.

Im Plan-Modus lehnt ACP native Änderungen und unbekannte Tool-Berechtigungen vor einer Freigabe ab. Zusätzliche externe MCP-Aufrufe sind in diesem Modus gesperrt, weil ihre Nebenwirkungen nicht unabhängig überprüft werden können. Im normalen Modus bleiben sie mit einer Freigabe pro Aufruf verfügbar.

## Kontext, Tokens und Kosten

BYOK beginnt mit den Werkzeugen für Verbindungen, Übersicht, Metadatensuche, Lesen (auch `code` für Mehrschritt-Lesen) und Visualisierung; `execute` wird nur angeboten, wenn eine ausgewählte Verbindung Schreibzugriffe erlaubt. `discover_tools` lädt bei Bedarf Dashboard-, Workflow-, Benchmark-, Wissens-, Import- und externe MCP-Werkzeuge. Eine leere Suche liefert deren Namen und Kurzbeschreibungen. Geladene Werkzeuge bleiben für die weiteren Modellrunden verfügbar und sind erst ab der nächsten Runde aufrufbar. Native CLI-Agenten verwenden weiterhin ihren vollständigen MCP-Katalog.

Werkzeugergebnisse werden im Modellkontext als Text übertragen; doppelte JSON-Verpackungen, wiederholtes `structuredContent` und binäre Inhalte entfallen. Fehler behalten einen ausdrücklichen Fehlerstatus im jeweiligen Provider-Protokoll. Der Modelltext pro Werkzeugergebnis ist auf höchstens 20.000 Zeichen plus Kürzungshinweis begrenzt; die Oberfläche erhält weiterhin das vollständige Ergebnis. Nach zwei identischen Fehlaufrufen wird die erneute Ausführung innerhalb derselben Anfrage gesperrt; korrigierte Argumente bleiben möglich. Erfolgreiche Abfragen werden weiter ausgeführt, damit aktuelle Daten sichtbar bleiben.

Statische Anweisungen und ausgewählte Skills stehen vor dem wechselnden Verbindungskontext, um wiederverwendbare Prompt-Präfixe zu erhalten. Dateivorschauen teilen sich ein Budget von 32.000 Zeichen und zeigen höchstens 50 Spalten; gespeichertes Wissen erhält höchstens 24.000 Zeichen pro Verbindung, jeweils mit ausdrücklichen Kürzungshinweisen. Dateien und gespeicherte Beschreibungen bleiben vollständig erhalten. `search` liefert standardmäßig 50 Treffer pro Seite und nennt den nächsten `offset`; `describe` verlangt bei mehrdeutigen Namen die vollständige Bezeichnung. TSV-Abfrageergebnisse werden an ganzen Zeilen begrenzt und melden ausgelassene Zeilen sowie eine vom Datenbanktreiber gemeldete Kürzung.

Der kompakte Status zeigt Kontextbelegung und Kosten; Details enthalten Eingabe-, Ausgabe-, Cache- und Reasoning-Tokens. Codex-Sitzungssummen, ACP-Kontextbelegung und BYOK-Modellrunden werden getrennt ausgewertet. Wiederholte Streaming-Snapshots ersetzen die betreffende Runde und werden nicht mehrfach addiert. Google-Thinking sowie Anthropic-Cache-Schreib- und Lese-Tokens erhalten ihre jeweilige Berechnung. Die Nutzungswerte bleiben im Gesprächsverlauf erhalten; beliebige Provider-Payloads und Auth-Daten werden dafür nicht gespeichert.

Gemeldete native Kosten haben Vorrang. Sonst sind Kosten explizite Tokenkostenschätzungen nach API-Standardtarifen (Stand 02.10.2026), bei unterschiedlichen Kontexttarifen als Spanne. Quellen: [OpenAI](https://developers.openai.com/api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing). Toolgebühren, Cache-Speicher, Abonnements und Rechnungsrabatte sind nicht Bestandteil dieser Schätzung. Preise und Kontextlimit können pro ausgewählter Modell-ID überschrieben werden. Unbekannte Preise oder Limits bleiben ausdrücklich unbekannt. Ohne native Tokenmessung gilt die sichtbare Textlänge geteilt durch vier als gekennzeichnete Näherung; zusätzliche Tool- und Skill-Inhalte fehlen dabei.

## Harness für Datenbankarbeit

Grundlage ist die Studie [An Empirical Study of Harness Design for Coding Agents](https://arxiv.org/abs/2609.20804) (Fan et al., 2026). Sie variiert Planung, Werkzeugsatz und Kontextverwaltung einzeln und kommt zu vier übertragbaren Ergebnissen: Kontextverwaltung verhindert vor allem Abbrüche durch volle Kontextfenster; regelbasiertes Kürzen vor einer Zusammenfassung ist am günstigsten; ein wiederherstellbares Archiv gekürzter Ergebnisse wird kaum genutzt; Planung hält schwache Modelle am Laufen und spart bei starken Modellen überflüssige Nachprüfungen. Vordefinierte Werkzeuge helfen schwächeren Modellen, starke Modelle profitieren von Aktionen, die mehrere Schritte bündeln. l8db setzt das so um:

| Erkenntnis | Umsetzung in l8db |
| --- | --- |
| Planung | BYOK-Werkzeug `plan` (höchstens 12 Schritte, genau einer in Arbeit). Der Plan erscheint als Todo-Liste im Chat und bleibt beim Kürzen erhalten. CLI-Agenten nutzen ihre eigene Todo-Liste. Lokale und kompatible Modelle erhalten zu Beginn zusätzlich einen kurzen Planungshinweis, große Anbietermodelle nicht. |
| Kontext nach Budget | Die Schwellen richten sich nach dem Kontextfenster des Modells (Profilangabe, sonst Anthropic 200.000, Google 1.000.000, lokal 32.000, andere 128.000 Token, gerechnet mit 3 Zeichen pro Token, abzüglich Systemprompt und Werkzeugdefinitionen). Ab 60 % (höchstens 120.000 Zeichen) werden ältere Werkzeugergebnisse außerhalb der letzten zwei Runden durch Stubs mit Werkzeugname, Argumenten und erster Zeile ersetzt. Ab 85 % (höchstens 200.000 Zeichen) werden die ältesten Runden regelbasiert in eine `<context-summary>` an der aktuellen Nutzernachricht verdichtet, ohne zusätzlichen Modellaufruf. Ein Abrufwerkzeug für gekürzte Ergebnisse gibt es bewusst nicht. |
| Gedächtnis über Nachrichten | Assistentenantworten gehen mit einem `<work-log>` in die nächste Anfrage: ausgeführte Werkzeuge, SQL und Ergebnis-Fußzeile (z. B. `(12 rows)`), höchstens 1.500 Zeichen, neueste zuerst behalten. So muss das Modell bekannte Tabellen und geprüfte Abfragen nicht erneut erkunden. |
| Bündelnde Aktionen | `describe` nimmt bis zu zehn Tabellen, Views oder Routinen. Tabellen erscheinen kompakt mit einer Zeile pro Spalte (`?` für nullable, `PK`, `→` Fremdschlüssel, Beschreibung), Indizes, eingehenden Fremdschlüsseln (falls der Fremdschlüsselgraph bereits geladen ist, höchstens zehn) und Zeilenschätzungen (PostgreSQL `reltuples`, MySQL `TABLE_ROWS`). Tabellen mit mehr als 60 Spalten zeigen die ersten 40 und fassen den Rest nach Präfix und Suffix zusammen; `columns` filtert mit Mustern wie `zz_*`. Routinen und Views zeigen Signatur, Sprache, Zeilenzahl, Abhängigkeiten (von der Datenbank gemeldet, sonst lexikalisch „from source“, inklusive schreibender Zugriffe) und den Quelltext nur ausschnittsweise: `lines` (Standard die ersten 120 Zeilen, höchstens 400) mit Gesamtzahl und dem nächsten Ausschnitt. `relations` liefert den kürzesten Join-Pfad über Fremdschlüssel als fertige `JOIN … ON …`-Zeilen und nennt alternative Schlüssel zwischen denselben Tabellen. Der Graph wird bei PostgreSQL, MySQL und SQL Server mit einer Katalogabfrage geladen, sonst pro Tabelle (höchstens 1.500 Tabellen, 8 parallel). Er enthält nur freigegebene Schemas, wird je Verbindung, Datenbank und Schema-Freigabe 120 Sekunden zwischengespeichert, nach Schreibzugriffen verworfen und bei unlesbaren Tabellen nicht gespeichert, sondern mit einem Hinweis auf mögliche Lücken ausgegeben. `describe` nennt keine Fremdschlüssel in nicht freigegebene Schemas. `explain` und `relations` gelten im Plan-Modus als lesend. |
| Überblick vor Details | `overview` liefert eine Karte fester Größe (unter etwa 1,5k Token, unabhängig von der Datenbankgröße): Schemas mit Tabellen, Zeilen und Größe, gleich aufgebaute Schemas zusammengefasst, größte Tabellen, häufige Namenspräfixe, Fremdschlüssel-Knoten (nur wenn Schlüssel ohnehin geladen sind), Anzahl Views, Funktionen, Prozeduren und Trigger, Abdeckung durch KI-Wissen und Katalogzeit. `schema` zoomt in ein Schema. `search` findet Tabellen, Views, materialisierte Views, Funktionen, Prozeduren und Trigger (Kennungen `T V M F P Trg`) mit Zeilenschätzung und Kommentar oder Wissensausschnitt; `kind` filtert, `in=source` sucht im Quelltext von Routinen und Views und liefert nur Objekt, Zeile und Ausschnitt. Der Katalog wird stufenweise mit Sammelabfragen geladen (Objekte und Statistiken, Spalten, Schlüssel, Quelltext nur bei Bedarf) und für Entdeckungswerkzeuge im Konfigurationsordner unter `mcp-catalogs/` gespeichert: eine Datei pro Verbindung und Datenbank, nur Metadaten und Zeilenschätzungen aus freigegebenen Schemas, Rechte 0600, kein Quelltext. Der Dateischlüssel enthält Schema-Freigabe und Maskierungsregeln; Dateien nicht mehr freigegebener Verbindungen werden gelöscht. Neu geladen wird nach Ablauf der TTL (10 min bis 6 h je nach Ladezeit), mit `refresh=true` oder nach DDL über MCP und KI-Arbeitsbereich. Sicherheitsprüfungen nutzen nie den gespeicherten Katalog, sondern laden nach höchstens 60 s live neu. Quelltextzeilen, die ein nicht freigegebenes Schema nennen, werden ausgeblendet; Triggerfunktionen und Signaturtypen aus solchen Schemas erscheinen als `[hidden]`. Messwerte: [mcp-token-benchmark.md](mcp-token-benchmark.md). |
| Prüfung nach Änderungen | `explain` zeigt den Ausführungsplan als kompakten Baum mit Warnungen (vollständige Scans ab 100.000 Zeilen, Schätzfehler ab Faktor 10, Sortieren auf Platte) und bei PostgreSQL Indexvorschläge des Index-Beraters, die nie ausgeführt werden. `analyze=true` ist nur für lesende Anweisungen erlaubt. Vor jeder `execute`-Freigabe läuft die Anweisung als Probelauf in einer Transaktion, die immer zurückgerollt wird, ohne dass die gemeinsame MCP-Sitzung blockiert. Das gilt für PostgreSQL, SQLite, DuckDB und SQL Server einschließlich DDL. Oracle, MySQL, ClickHouse und andere sind ausgenommen, weil dort Prozeduren, implizite Commits oder Speicher-Engines ein Zurückrollen nicht garantieren. Ebenso ausgenommen sind Anweisungen mit möglichen Nebenwirkungen außerhalb der Transaktion (`CALL`, `EXEC`, `BEGIN`, `DO`, `COPY`, `EXPORT`, `ATTACH`, `VACUUM`, `CONCURRENTLY`, `nextval` und ähnliche). Anweisungen, die nicht in einer Transaktion laufen dürfen, werden ohne Probelauf zur Freigabe vorgelegt. Die Freigabekarte zeigt die Auswirkung, etwa „Probelauf: 3 Zeilen betroffen“, und warnt bei UPDATE oder DELETE ohne WHERE. Schlägt der Probelauf fehl, bekommt das Modell den Fehler zurück und der Nutzer wird nicht gefragt. Ein Zeitlimit im Probelauf blockiert nicht, die Auswirkung gilt dann als unbekannt. Der Probelauf hält Zeilensperren bis zum Zurückrollen, höchstens bis zum Abfrage-Zeitlimit. Die Warnung ohne WHERE berücksichtigt nur ein WHERE auf oberster Ebene, nicht in Unterabfragen. |
| Wiederholungen | Neben der bestehenden Sperre nach zwei identischen Fehlaufrufen erhält das Modell nach drei identischen erfolgreichen Aufrufen in Folge einmal den Hinweis, weiterzugehen. |
| Rundenbudget | Höchstens 40 Werkzeugrunden pro Anfrage statt 12. Drei Runden vor Schluss kommt ein Hinweis zum Abschließen; in der letzten Runde sind Werkzeugaufrufe per `tool_choice` gesperrt, sodass das Modell antwortet, statt mit einem Fehler abzubrechen. |

Der Systemprompt beschreibt den Arbeitsablauf eines sorgfältigen Datenbankentwicklers: mehrere Tabellen auf einmal beschreiben, Join-Pfade über `relations`, `explain` vor schweren Abfragen und zur Bestätigung von Optimierungen, Rückweg für Schemaänderungen nennen, eine Änderung genau einmal gezielt prüfen und am Ende Ergebnis, Prüfung und Offenes nennen.

## Prüfen, simulieren, erklären

Fünf Fähigkeiten gehen über Fragen und Antworten hinaus. Sie bauen aufeinander auf:

- **Datenregeln** (`rules`, nachladbar): Geschäftsregeln, die in den Daten gelten müssen. Jede Regel ist eine lesende Abfrage, die die verletzenden Zeilen liefert. `check` prüft Kandidaten und zeigt Anzahl und bis zu drei Beispielzeilen (geschwärzt), ohne zu speichern. `save` prüft erneut, verlangt eine Freigabe und speichert pro Verbindung in `ai-knowledge.json` (`invariants`, höchstens 100, je 4.000 Zeichen SQL). `list` prüft alle gespeicherten Regeln neu und aktualisiert Anzahl und Prüfzeit, `delete` braucht eine Freigabe. Gespeicherte Regeln stehen in jedem Gespräch im Systemprompt (höchstens 6.000 Zeichen). Im KI-Wissen-Dialog erscheinen sie unter „Datenregeln“ mit Status, SQL und „Mit KI finden“. Zur Überwachung baut die KI auf Wunsch einen Workflow aus `set_variable` (`row_count`), `condition` und `notify`.
- **Sandbox** (`sandbox`, Kern-Werkzeug): Bis zu 20 Anweisungen einschließlich DDL laufen in einer Transaktion. Bis zu 8 Messungen (`probes`) und alle gespeicherten Datenregeln werden davor und danach in derselben Transaktion gemessen. Danach wird immer zurückgerollt, auch nach Fehlern; scheitert das Rollback, wird die Verbindung geschlossen und der Bericht warnt. Einzelwerte erscheinen als „vorher → nachher (Δ, %)“, sonst als zwei kleine Tabellen. Regeln, die neu verletzt würden, sind markiert. Dasselbe Werkzeug beantwortet Was-wäre-wenn-Fragen: Szenario anwenden, Kennzahlen messen, zurückrollen. Nur PostgreSQL, SQLite, DuckDB und SQL Server. Die Sandbox braucht dieselben Rechte wie `execute`: Schreibzugriff im Gespräch, kein Plan-Modus, keine schreibgeschützte oder Produktionsverbindung, DDL nur mit DDL-Freigabe. Sie läuft immer mit Freigabe (im Modus „MCP automatisch“ ohne Rückfrage). Schema-Freigaben, Schwärzung und gesperrte Funktionen gelten weiter. Gesperrt sind Transaktionssteuerung (`COMMIT`, `ROLLBACK`, `BEGIN`, `SAVEPOINT`, `SET` …) und alles, was der Probelauf von `execute` ausschließt (`CALL`, `EXEC`, `DO`, `COPY`, `nextval`, `CONCURRENTLY` …). Auf SQL Server sind außerdem `EXEC`, `EXECUTE` und `sp_executesql` überall in der Anweisung gesperrt. PostgreSQL bekommt `lock_timeout = 5s`, SQL Server `LOCK_TIMEOUT 5000`; Zeilensperren gelten bis zum Zurückrollen. Weil PostgreSQL (Simple Query) und SQL Server (Batch) mehrere Anweisungen pro Aufruf annehmen, prüft die Sandbox vor und nach jeder Anweisung mit `txid_current()` bzw. `@@TRANCOUNT`, dass noch dieselbe Transaktion offen ist, und bricht sonst mit einer Warnung ab. SQLite und DuckDB führen pro Aufruf nur eine Anweisung aus. Schlägt eine Messung vor den Änderungen fehl, läuft keine Anweisung.

Die SQL-Prüfungen (`statement_count`, `sql_words`, `write_word`, `dangerous_word`, `check_references`) lesen jede Anweisung zweimal: einmal mit MySQL-Regeln (Backslash-Escapes in Strings, `#` als Kommentar) und einmal ohne. Es gilt das strengere Ergebnis. Vorher konnte `'\'; COMMIT; --'` oder `SELECT 1 # x; DELETE …` in PostgreSQL und SQL Server eine zweite Anweisung verstecken; das betraf auch `query` und `execute`. Leseprüfungen (`query`, `code`, `explain` und alle anderen lesenden Wege über `check_read_sql`) lesen zusätzlich im genauen Dialekt der Verbindung:

- MySQL: `"…"` als String mit Backslash-Escapes, `--` nur mit folgendem Leerzeichen als Kommentar, keine Dollar-Quotes, keine verschachtelten Kommentare.
- PostgreSQL und DuckDB: `E'…'` mit Escapes, `[` ist kein Bezeichner.
- SQLite: keine verschachtelten Kommentare.
- ClickHouse und BigQuery: Backslash-Escapes auch in `` `…` `` und `"…"`.

Sonst ließen sich mit Mischformen wie `SELECT 1 --1, email AS x FROM t` (MySQL) oder `/* /* */ , email … -- */` (SQLite, MySQL) geschwärzte Spalten oder zweite Anweisungen an beiden Lesarten vorbeischmuggeln. Ein Dollar-Tag zählt nur noch, wenn er wie `$tag$` aus Bezeichnerzeichen besteht. Ohne genaue Lesart bleiben SQL Server, Oracle (`q'[…]'`), Snowflake, Athena, Cassandra und ODBC sowie die Schreibprüfung von `execute`.
- **Ursachenanalyse** (`drilldown`, Kern-Werkzeug und im öffentlichen MCP): Erklärt die Veränderung einer additiven Kennzahl (Summe oder Anzahl) zwischen zwei Zeiträumen. Pro Dimension (höchstens 8) läuft eine `GROUP BY`-Abfrage mit `CASE`-Summen für beide Zeiträume, nacheinander statt parallel. Die Bewertung folgt Adtributor (Bhagwan et al., NSDI 2014): Erklärungskraft je Segment (Anteil an der Gesamtveränderung) und Überraschung (Jensen-Shannon-Divergenz der Anteile). Segmente mit mindestens 10 % Anteil werden gesammelt, bis 67 % erklärt sind. Dimensionen werden nach Überraschung sortiert; eine gleichmäßige Veränderung über alle Segmente hat keine Überraschung. Mit `depth=2` (Standard) wird im stärksten Segment eine Ebene tiefer mit den übrigen Dimensionen zerlegt. Die erzeugten Abfragen durchlaufen dieselbe Leseprüfung wie `query`; Segmentwerte werden nach dem Spaltennamen der Dimension geschwärzt. Höchstens 1.000 Segmente pro Dimension werden gelesen, sortiert nach Betrag der Veränderung; Gesamtwerte und Anteile kommen aus einer eigenen Summenabfrage und stimmen deshalb auch dann. Scheitert die zweite Ebene, bleibt die erste mit einem Hinweis erhalten.
- **Mehrschritt-Lesen** (`code`, Kern-Werkzeug und im öffentlichen MCP): Für Arbeit über viele Schemas, Tabellen, Anweisungen oder Verbindungen schreibt das Modell eine JavaScript-Funktion `async () => {…}` statt vieler `query`-Aufrufe. l8db führt sie in einem eigenen, kurzlebigen Prozess aus (`l8db --mcp-sandbox`, QuickJS) ohne Netzwerk, Dateien und Umgebungsvariablen. Zum Modell gehen nur der Rückgabewert (ein Array flacher Objekte als TSV), `console.log` und eine Fußzeile mit Anweisungen, gelesenen Zeilen und Dauer.
  - Bindings: `sql` als Tagged Template, `sql.with({connection, database})` für eine andere freigegebene Verbindung, `query(text)`, `explain(text)`, `id(schema, name)` und `catalog` mit `schemas`, `tables`, `columns`, `routines`, `source`, `grep`, `references` und `path`.
  - `${wert}` wird zum Literal im Dialekt der Verbindung, ein Array zu `(a, b)`. Bezeichner gibt es nur über `id()`.
  - Jede Anweisung durchläuft dieselben Prüfungen wie `query`: nur lesend, Schema-Freigabe, geschwärzte Spalten, Read-only-Sitzung und Abfrage-Zeitlimit. Jede bekommt einen eigenen Audit-Eintrag mit `tool=code`.
  - Werte werden geschwärzt, bevor sie den Prozess erreichen. Der Katalog zeigt keine nicht freigegebenen Schemas.
  - SQL-Fehler werfen im JavaScript und lassen sich abfangen. JS-Fehler kommen mit Zeilennummer und Codezeile zurück.
  - Grenzen: 500 Anweisungen, davon höchstens 4 gleichzeitig, 10.000 Zeilen pro Anweisung und 250.000 pro Lauf, 64 MB Speicher. Die Gesamtzeit ist das Vierfache des Abfrage-Zeitlimits, mindestens 120 s. Danach wird der Prozess beendet, ebenso beim Abbruch des Gesprächs.
  - Das Werkzeug gilt als lesend: Es ist im Plan-Modus erlaubt und wird freigegeben wie `query`.

  Beispiel: verwaiste Bestellungen über alle Mandanten-Schemas in einem Aufruf.

  ```js
  async () => {
    const schemas = (await catalog.tables({ name: "orders" })).map((t) => t.schema);
    const counts = await Promise.all(schemas.map((s) => sql`SELECT count(*) AS n FROM ${id(s, "orders")} o WHERE NOT EXISTS (SELECT 1 FROM ${id(s, "customers")} c WHERE c.id = o.customer_id)`));
    return schemas.map((schema, i) => ({ schema, orphans: counts[i][0].n })).filter((r) => r.orphans > 0);
  }
  ```

  Bei 300 Schemas braucht das 1 statt 301 Aufrufe und etwa 1 KB statt 56 KB Kontext. Messwerte: [mcp-token-benchmark.md](mcp-token-benchmark.md#phase-3).
- **Notebooks** (`notebook`, nachladbar): Legt aus einer Untersuchung ein neues, ungespeichertes Notebook mit Markdown- und SQL-Zellen an (höchstens 40) und öffnet die Notebook-Ansicht. Ein Notebook mit ungespeicherten Änderungen wird nie überschrieben; das Modell bekommt dann einen Hinweis.

Der Systemprompt verlangt, Migrationen, Backfills und Massenänderungen vor dem Vorschlag in der Sandbox zu testen, Was-wäre-wenn-Fragen dort zu messen statt zu schätzen und Warum-Fragen zu Kennzahlen zuerst mit `drilldown` zu zerlegen. Die Beispielfragen im leeren Chat zeigen Ursachenanalyse, Sandbox und Datenregeln.

## Entwicklung

Start im Feature-Worktree: `bun run dev:ai`. Diese Konfiguration nutzt Port 1422 und eine eigene App-Kennung, um den laufenden Haupt-Dev-Server auf 1420 nicht zu ersetzen. Der gemeinsame bestehende MCP-Konfigurationsordner bleibt erhalten; KI-Anfragen ändern dessen Verbindungsfreigaben nicht.

Die Bereinigung von `l8db-dev-lab` entfernte die nicht laufende alte Dev-App (ca. 300 MB). Einzigartige Lab-Repositories, private Bootstrap-Dateien, Datenbanken und Oracle-Laufzeit wurden erhalten.
