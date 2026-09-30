# Unternehmenseinsatz: Sicherheitsbewertung vom 30.09.2026

Für einen Einsatz mit verbindlicher Vier-Augen-Freigabe und manipulationsgeschützter Revision besteht noch keine Produktionsfreigabe. Die Desktop-Version ist ein Entwicklungs- und kontrolliertes Rollout-Werkzeug; die folgenden Grenzen müssen vor einem regulierten Unternehmenseinsatz behoben und unabhängig geprüft werden.

## Vorhandene Kontrollen

Commitgebundene Releases mit Prüfsummen, unveränderliche veröffentlichte Manifest-Dateien, explizite Kundenziele, tatsächliche Datenbankidentität, Drift-Prüfung, schreibgeschützte Verbindungen, Tunnel ohne direkten Fallback, revisionsgebundene Datenbankregeln und Freigaben durch einen anderen Datenbankbenutzer. Datenbank-Sperren koordinieren mehrere Rechner. Ausführungen laufen im Rust-Backend; PostgreSQL verwendet eine Transaktion pro Release. Oracle-Teilzustände bleiben ausdrücklich ungeklärt. Es gibt keinen automatischen Retry nach einer verlorenen Commit-Antwort.

Gemeinsame Konfiguration liegt in `database/team.json`. Die Datei erlaubt ausschließlich Kunden, Umgebungen, logische Verbindungen, TLS-/Tunnelanforderungen, Branch-Zuordnungen und Update-Regeln. Lokale Profil-IDs, Zugangsdaten, Baseline und Ausführungshistorie werden nicht exportiert. Ein Clone benötigt ausdrücklich zugeordnete Profile und einen erneuten Baseline-Abgleich. Geänderte Zielidentität invalidiert den lokalen Stand. Uncommittete Teamkonfiguration, ein veralteter Konfigurationshash und widersprüchliche Git-/Datenbankregeln blockieren den Rollout.

## Verbindliche offene Punkte

| Priorität | Grenze | Erforderliche Umsetzung |
|---|---|---|
| P0 | Der Besitzer des Zielschemas kann Kontrolltabellen, Regeln und Journal ändern oder entfernen. | Kontrollschema durch getrennte Rolle besitzen lassen; Rechte für Deployer, Administrator und Reviewer getrennt und restriktiv vergeben; direkte Tabellenänderungen technisch verhindern. |
| P0 | Der lokale Client liefert den Ausführungsplan. Das Backend prüft nicht unabhängig dessen gesamten Inhalt gegen eine vertrauenswürdige Release-Quelle. | Server prüft Commit, vollständige Vorgängerkette, Migrationen, Betriebsplan und Prüfanweisungen selbst; Eingaben des Clients gelten als untrusted. |
| P0 | Git- und SQL-Prüfsummen beweisen Integrität, keine vertrauenswürdige Herkunft. | Geschützte Remote-Branches, verpflichtende Reviews, signierte Releases und Prüfung gegen freigegebene Herausgeber/CI-Provenance. |
| P0 | Vier-Augen-Freigabe ist konfigurierbar und kein organisatorisch zwingender Standard. | Unveränderliche Produktionsrichtlinie mit getrennten DB-Identitäten, verpflichtender Freigabe und begrenzter Gültigkeit. |
| P1 | Auditdaten im Zielschema und lokal sind durch privilegierte Benutzer veränderbar. | Externes append-only Journal mit gesichertem Zeitbezug, zentraler Auswertung und Aufbewahrung. |
| P1 | Desktop-Prozess oder Rechner können während der Ausführung ausfallen. | Dauerhafter zentraler Executor, beobachtbarer Jobstatus, explizite Wiederaufnahme und Verifikation des tatsächlichen Ausgangs. |
| P1 | Kundenflotten werden sequenziell aktualisiert; es gibt keine atomare Transaktion über alle Ziele. Oracle-DDL kann implizit committen. | Canary-Wellen, Wartungsfenster, Abbruchkriterien, nachgewiesene Backups/PITR und geübte Wiederherstellung. |
| P1 | Snapshots decken weder alle Grants/RLS-Regeln noch sämtliche DB-Optionen oder fachliche Datenkorrektheit ab. | Berechtigungen und herstellerspezifische Optionen zusätzlich versionieren und prüfen; fachliche Vor-/Nachbedingungen für Datenmigrationen verlangen. |

Die Git-Konfiguration beschreibt gewünschte Regeln. Ein Git-Commit allein erweitert keine Datenbankberechtigung und überschreibt keine laufende Datenbankrichtlinie. Regeländerungen müssen über eine autorisierte Identität angewendet werden. Für echte Produktionsrollouts gehören kurzlebige Zugangsdaten, ein Credential-Broker und der zentral abgesicherte Executor außerhalb des Entwicklerrechners in die Architektur.

## Begründung und Quellen

Die Eigentümerrechte zum Ändern oder Zerstören eines PostgreSQL-Objekts sind Teil der Ownership. Ein bloßes REVOKE auf dieselbe Rolle trennt diese Verantwortung nicht: [PostgreSQL 18: Privileges](https://www.postgresql.org/docs/18/ddl-priv.html). Artefaktherkunft verlangt eine Prüfung vertrauenswürdiger Producer und Build-Informationen: [SLSA: Verifying artifacts](https://slsa.dev/spec/v1.2/verifying-artifacts). Die organisatorischen und technischen Nachweise sollten auf einem festgelegten Secure-Development-Prozess beruhen: [NIST SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final).

## Lokales Labor

Das private Labor liegt außerhalb des App-Repositories unter `/Users/leon/l8db-dev-lab`. PostgreSQL 18 ist ausschließlich über Loopback-Port 55440 erreichbar und enthält Development sowie zwei getrennte Kundendatenbanken. Oracle Free 23.26.3 ist ausschließlich über Loopback-Port 55441 erreichbar und enthält `L8DB_DEV`, `L8DB_CUSTOMER_A` und `L8DB_CUSTOMER_B` in `FREEPDB1`. Die Oracle-Benutzer besitzen begrenzte Quotas und ausschließlich erforderliche Entwicklungsrechte. Alle Daten sind synthetisch; Zugangsdaten werden nicht dokumentiert oder eingecheckt. Das Image stammt aus dem [offiziellen Oracle-Free-Containerprojekt](https://github.com/gvenzl/oci-oracle-free).

## Tatsächlich geprüfter Stand

Die Bedienprüfung erfolgte über natives Computer Use in der Tauri-Dev-App. T3-Browserwerkzeuge wurden dafür nicht verwendet.

| Ablauf | Beobachtetes Ergebnis |
|---|---|
| PostgreSQL-Verbindung, Git-Initialisierung, Schema-Aufnahme und Release | Development-Profil verbunden, echtes Repository über die Oberfläche initialisiert, vier Objekte aufgenommen und Baseline `1.0.0` gespeichert und committet. |
| Zwei Kundenziele | `Internal · Development` und `Customer A · Test` mit getrennten Datenbanken geprüft; Baseline jeweils gegen die tatsächlichen Definitionen abgeglichen. |
| Gemeinsame Teamkonfiguration | Bestehende Zuordnungen über die Oberfläche in Git übernommen und committet; Branch-Zuordnung ebenfalls committet. |
| Git-Branch und Swimlanes | `feature/customer-active` angelegt, tatsächlich ausgecheckt, Development-Ziel zugeordnet; Fork und Branch-Referenzen im Graph sichtbar. |
| Development-Seeds | Auf `main` gesperrt. Auf dem Feature-Branch SQL für 20 synthetische Kunden erzeugt, gespeichert und committet; dabei wurden keine Zeilen eingefügt. |
| Seed-Ausführung | Erster Versuch wurde wegen unterschiedlicher Prüfsummen-Normalisierung abgewiesen. Ursache korrigiert und durch Backend-Regressionstest abgesichert; erneute native Ausführung noch offen. |
| Oracle-Verbindungen | Development, Customer A und Customer B in der Oberfläche erfolgreich getestet und aktiviert. Jedes Profil zeigt seine eigenen zwei Tabellen; der Login-Schema-Fallback wurde korrigiert. |
| Oracle-Kundentrennung | `USER` und `CURRENT_SCHEMA` für Customer B bestätigt. Zugriff von B auf `L8DB_CUSTOMER_A.CUSTOMERS` endet mit `ORA-00942`. |
| Light Mode | Eingabefelder und Auswahllisten mit gemeinsamen UI-Primitiven und sichtbar kräftigeren Rahmen in der nativen Ansicht geprüft. |

Der PostgreSQL-Laborverlauf endet beim Seed-Commit `6cacfb2`; die Development-Kundentabelle enthält weiterhin null Zeilen. Ein vollständiger neuer Migrationsrollout und die Oracle-Versionierungsabläufe wurden in diesem Lauf noch nicht abgeschlossen. Computer Use liefert beim erneuten Öffnen von Dev-App und Finder `cgWindowNotFound`; der später beobachtete Oracle-Client-Ladevorgang blockiert im Betriebssystem. Die Treibererkennung lädt OCI nun erst beim Verbindungsaufbau, außerhalb des UI-Threads. Ein frischer nativer Start und die ausstehenden Abläufe müssen nach Wiederherstellung der grafischen Sitzung geprüft werden.

Technische Prüfungen: TypeScript und Vite-Build bestanden; 81 gezielte Frontend-Tests bestanden, neun Live-Szenarien blieben deaktiviert. Der vollständige Rust-Lauf bestand mit 431 Tests und 98 ignorierten Laborszenarien; der anschließend ergänzte Regressionstest für die OCI-freie Treibererkennung bestand ebenfalls. Biome und Clippy liefen ohne Fehler mit bestehenden Warnungen. Der vollständige Frontend-Lauf meldete zwei Importfehler durch einen fehlenden `addPluginListener`-Export im kombinierten Tauri-Mock; die betroffenen Dateien bestanden isoliert mit neun Tests. `production:check` scheitert an der parallel bearbeiteten Fenster-Capability `win-*`, die nicht zu diesem Änderungspaket gehört.

Eine vorhandene Schutzfunktion oder ein Unit-Test allein gilt nicht als Nachweis eines produktionsreifen Sicherheitssystems. Im Labor besitzt der Development-Benutzer die PostgreSQL-Kontrolltabellen weiterhin selbst; damit ist die erforderliche Trennung privilegierter Rollen ausdrücklich nicht nachgewiesen.
