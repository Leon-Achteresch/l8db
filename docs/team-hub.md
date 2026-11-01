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
