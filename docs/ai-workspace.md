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

## KI-Wissen

Pro Verbindung speichert l8db Notizen, ein Glossar und Beschreibungen für Tabellen und Spalten in `ai-knowledge.json` im Konfigurationsordner. Das Wissen der ausgewählten Verbindungen steht in jedem Gespräch im Systemprompt (höchstens etwa 24 KB) und ist dort als Hinweis, nicht als Anweisung gekennzeichnet. Es lässt sich im Plus-Menü unter „KI-Wissen“ bearbeiten. „Mit KI erzeugen“ startet ein Gespräch, in dem das Modell alle Tabellen ansieht und die Beschreibungen über das Tool `knowledge` speichert. Das Tool fragt im Modus „Immer fragen“ vor dem Speichern und ist im Plan-Modus gesperrt.

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

Der kompakte Status zeigt Kontextbelegung und Kosten; Details enthalten Eingabe-, Ausgabe-, Cache- und Reasoning-Tokens. Codex-Sitzungssummen, ACP-Kontextbelegung und BYOK-Modellrunden werden getrennt ausgewertet. Wiederholte Streaming-Snapshots ersetzen die betreffende Runde und werden nicht mehrfach addiert. Google-Thinking sowie Anthropic-Cache-Schreib- und Lese-Tokens erhalten ihre jeweilige Berechnung. Die Nutzungswerte bleiben im Gesprächsverlauf erhalten; beliebige Provider-Payloads und Auth-Daten werden dafür nicht gespeichert.

Gemeldete native Kosten haben Vorrang. Sonst sind Kosten explizite Tokenkostenschätzungen nach API-Standardtarifen (Stand 02.10.2026), bei unterschiedlichen Kontexttarifen als Spanne. Quellen: [OpenAI](https://developers.openai.com/api/docs/pricing), [Anthropic](https://platform.claude.com/docs/en/about-claude/pricing), [Google](https://ai.google.dev/gemini-api/docs/pricing). Toolgebühren, Cache-Speicher, Abonnements und Rechnungsrabatte sind nicht Bestandteil dieser Schätzung. Preise und Kontextlimit können pro ausgewählter Modell-ID überschrieben werden. Unbekannte Preise oder Limits bleiben ausdrücklich unbekannt. Ohne native Tokenmessung gilt die sichtbare Textlänge geteilt durch vier als gekennzeichnete Näherung; zusätzliche Tool- und Skill-Inhalte fehlen dabei.

## Entwicklung

Start im Feature-Worktree: `bun run dev:ai`. Diese Konfiguration nutzt Port 1422 und eine eigene App-Kennung, um den laufenden Haupt-Dev-Server auf 1420 nicht zu ersetzen. Der gemeinsame bestehende MCP-Konfigurationsordner bleibt erhalten; KI-Anfragen ändern dessen Verbindungsfreigaben nicht.

Die Bereinigung von `l8db-dev-lab` entfernte die nicht laufende alte Dev-App (ca. 300 MB). Einzigartige Lab-Repositories, private Bootstrap-Dateien, Datenbanken und Oracle-Laufzeit wurden erhalten.
