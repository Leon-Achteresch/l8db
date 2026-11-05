# Team-Verbindungen: Verbindungen per Datei verteilen

Die IT legt auf jedem Rechner eine JSON-Datei mit den Firmenverbindungen ab. l8db liest sie beim Start und beim Wechsel ins Fenster (höchstens einmal pro Minute) und zeigt die Verbindungen in der normalen Verbindungsliste. Es gibt keine Anmeldung, keinen Server und keine Microsoft- oder OIDC-Anbindung.

## Pfad

| System | Datei |
|---|---|
| Windows | `%APPDATA%\.l8db\connections.json` (z. B. `C:\Users\max\AppData\Roaming\.l8db\connections.json`) |
| macOS / Linux | `~/.l8db/connections.json` |

Verteilen lässt sich die Datei mit jedem Werkzeug für Benutzerdateien: Gruppenrichtlinie (*Benutzerkonfiguration → Einstellungen → Windows-Einstellungen → Dateien*), Intune-Skript, Anmeldeskript, MDM auf dem Mac. *Einstellungen → Allgemein → Team-Verbindungen* zeigt den genauen Pfad, die Anzahl, Fehler und Hinweise und lädt die Datei auf Knopfdruck neu.

## Format

Eine Liste oder ein Objekt mit `connections`:

```json
{ "connections": [
  { "id": "erp-produktion", "name": "ERP Produktion", "kind": "mssql", "connectionString": "mssql://erp.firma.intern:1433/erp?encrypt=true", "environment": "production", "readOnly": true },
  { "id": "reporting", "name": "Reporting", "kind": "postgres", "connectionString": "postgres://bi_leser@reporting.firma.intern:5432/bi", "sslMode": "verify-full" }
] }
```

- Pflicht: `id` (`A-Z a-z 0-9 _ -`, stabil halten: eine neue `id` ist eine neue Verbindung), `name`, `kind`, `connectionString` **ohne Passwort oder Token**. Ist ein Benutzer eingetragen, fragt l8db nur nach dem Passwort; das Passwort landet im OS-Schlüsselbund.
- Optional: `sslMode`, `ssh`, `proxy`, `cloudAuth`, `tags`, `color`, `readOnly`, `environment`, `schemas`, `description`, `owner`, `contact`, `runbook` (HTTPS). Andere Felder werden ignoriert. Bei `ssh` werden Schlüsseldatei und Agent-Socket nicht übernommen.
- Erlaubte Typen: `postgres`, `mysql`, `mssql`, `oracle`, `clickhouse`, `mongodb`, `redis`, `cassandra`, `elasticsearch`, `influxdb`, `snowflake`, `bigquery`, `athena`, `dynamodb`, `s3`, `sqlite_http`, `odbc`. Lokale SQLite-/DuckDB-Dateien werden weiterhin gerätelokal eingerichtet.
- Abgelehnt werden Einträge mit Passwort, Steuerzeichen oder Parametern für lokale Anmeldedaten, Sockets oder Schlüsseldateien (z. B. `sslkey`, `tlsCAFile`). Integrierte Windows-Anmeldung ist mit gültigen booleschen Werten erlaubt; die tatsächliche Unterstützung hängt vom Betriebssystem und Treiber ab. ODBC erlaubt installierte Treibernamen, keine lokalen Treiberdateien oder File-DSNs. Abgelehnte Einträge erscheinen als *Hinweise für die IT*, der Rest bleibt nutzbar.
- Höchstens 4 MB. Eine UTF-8-BOM ist erlaubt.

## Verhalten

- Neue Einträge werden ergänzt, entfernte gelöscht. Lokale Änderungen an Name, Farbe und Benutzer bleiben, solange die IT dasselbe Feld nicht ändert. Sicherheitsrelevante Felder einschließlich Adresse, Typ, TLS, Umgebung, Schema-Auswahl und Lesemodus bleiben durch die IT vorgegeben.
- Ändert die IT Typ, Adresse, SSL-Modus, SSH oder Proxy, löscht l8db die gespeicherten Passwörter und fragt neu.
- Fehlt die Datei, verschwinden alle Team-Verbindungen. Ist sie unlesbar oder kein gültiges JSON, bleibt alles unverändert und der Fehler steht in den Einstellungen.
- Team-Verbindungen werden nicht über die persönliche Synchronisation übertragen.
- Rechte in der Datenbank regelt ausschließlich der Datenbank-Benutzer.
- Der Lesemodus blockiert Schreibaktionen in l8db für jede Datenbankfamilie. PostgreSQL und S3 ergänzen ihren nativen Schutz. Leserechte müssen trotzdem serverseitig vergeben werden; Clientkontrollen sind keine Datenbankberechtigungen.
- Verbindungen aus dem früheren Team-Hub oder aus Microsoft 365 entfernt l8db beim ersten Lesen.

## Tests

Verbindliche Maschinenrichtlinien und der vollständige Ablauf für IT, DBA und Anwender: [enterprise-rollout.md](enterprise-rollout.md).

- `bun test tests/team-sync.test.ts`: Merge, Abgleich, Altbestand, Performance.
- `cargo test team` (in `src-tauri/`): Lesen der Datei.


## Zentraler Team-Workspace

Die dateibasierten Team-Verbindungen oben bleiben ein eigener Weg. Unter **Team-Workspaces** lässt sich zusätzlich ein zentraler Workspace mit Anmeldung, Einladungen, Admin-/Mitgliederrollen, Verbindungsrechten, gemeinsamen SQL-Abfragen, Freigaben und Auditprotokoll verwenden. Gespeicherte Verbindungen enthalten nur `workspace://profil-id/verbindung-id`; Sitzungen liegen im Backend-Schlüsselbund.

Der lokale Server wird in der Oberfläche gestartet. Für einen eigenständigen Server:

```sh
L8DB_WORKSPACE_ADMIN_EMAIL=admin@example.com L8DB_WORKSPACE_ADMIN_PASSWORD='<eigenes Passwort>' l8db --workspace-server --data /absoluter/pfad/workspace --listen 127.0.0.1:3891
```

Die Bootstrap-Variablen werden beim ersten Start benötigt. Eine entfernte Bindung braucht `--allow-remote` und einen HTTPS-Reverseproxy. Clients akzeptieren unverschlüsseltes HTTP ausschließlich auf Loopback; der Server ist kein Browser-API-Endpunkt. Lokale SQLite-Dateien müssen ausdrücklich mit `--allow-local-files` erlaubt werden und sind nur bei Loopback-Bindung zulässig. Quellen sind derzeit PostgreSQL, MySQL und SQLite.

Die Login-Drosselung verwendet getrennte Caches für bekannte Konten, unbekannte E-Mail-Adressen und echte TCP-Peers mit jeweils höchstens 256 Einträgen. Bei Kapazität werden alte Einträge verdrängt; fremde Adressen füllen keine globale Anmeldesperre. Für Konten gelten zehn Versuche je fünf Minuten. Ab 32 Fehlversuchen je Peer werden unbekannte Konten begrenzt. Korrekte Zugangsdaten existierender Konten bleiben hinter derselben Proxy-/NAT-IP verwendbar. Ungeprüfte `X-Forwarded-For`- oder `Forwarded`-Header werden nicht als Clientidentität verwendet.

Das Datenverzeichnis hat Modus 0700, `credentials.key` Modus 0600. Datenbank und Schlüssel müssen gemeinsam gesichert werden: Ohne den Schlüssel lassen sich gespeicherte Verbindungsdaten nicht wiederherstellen. Der Schlüssel liegt bei diesem Headless-Betrieb als geschützte Datei auf dem Server.

Eine Abfrage liefert höchstens 1.000 Zeilen bzw. 4 MiB HTTP-Antwort, läuft höchstens 30 Sekunden und teilt sich vier Ausführungsplätze. Ein einzelner großer Wert kann im Quelladapter bereits vor der Antwortbegrenzung mehr Speicher beanspruchen. Gespeicherte SQL-Abfragen sind auf 1 MiB je Inhalt, 1.000 Einträge/8 MiB gesamt begrenzt; Freigabeanträge auf 500 Einträge/8 MiB und 24 Stunden. Listen liefern Vorschauen, vollständiges SQL wird einzeln vor Bearbeiten oder Freigabe geladen. Das Auditprotokoll behält 50.000 Einträge.

Lesende SQL-Abfragen erhalten jeweils eine eigene Datenbanksitzung mit nativem Leseschutz. Dadurch gelangen Transaktionszustand oder Sitzungseinstellungen nicht in andere Abfragen. Der Preis dafür ist ein neuer Verbindungsaufbau einschließlich der gegebenenfalls nötigen TLS- und Anmeldungsschritte. Wiederholte Abfragen verwenden deshalb weiterhin höchstens vier Ausführungsplätze statt zusätzlicher Hintergrundverbindungen. Ohne Benutzeraktion wird nicht erneut abgefragt. Der MySQL-Livetest `tests/workspaces-mysql-live.test.ts` prüft wiederholte Leseabfragen gegen 10.000 Quellzeilen, Latenz, Ergebnisgröße, Datenbankanfragen, Verbindungen, Abbruch und Leerlauf; ein lokaler Lauf ersetzt keine Messung der Latenz eines entfernten TLS-Servers.

Änderungen an gemeinsamen SQL-Abfragen prüfen die Revision. Freigaben prüfen Autor, aktuellen Status und aktuelle Rechte auf dem Server; Autor und Freigebender müssen verschieden sein. Rechte- oder Sitzungsentzug bricht laufende Jobs ab. Gemeinsame SQL-Ergebnisse werden virtualisiert dargestellt. Microsoft-/OIDC-/SAML-SSO ist in diesem Workspace nicht implementiert.
