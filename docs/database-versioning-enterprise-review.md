# Unternehmenseinsatz: Sicherheitsbewertung vom 01.10.2026

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
| Development-Seeds | Auf `main` gesperrt. Auf dem Feature-Branch SQL für 20 synthetische Kunden erzeugt, gespeichert und committet; anschließend über die native Oberfläche genau 20 Zeilen in Development eingefügt. Customer A und B enthalten weiterhin keine Seed-Zeilen. |
| Automatische PostgreSQL-Migration | `active boolean NOT NULL DEFAULT true` in Development über den SQL-Editor angelegt. PostgreSQL-18-NOT-NULL-Metadaten zunächst als manuelle Änderung erkannt; Ursache korrigiert. Release `1.1.0` enthält danach die automatisch erzeugte ADD-COLUMN-Migration und eine SQL-Nachprüfung. |
| PostgreSQL-Rollout | Native Planung meldet null Drift und die tatsächliche Identität von Customer A. Release `1.1.0` ausdrücklich bestätigt und ausgeführt; Oberfläche zeigt „Welle abgeschlossen“. Development anschließend gegen `1.1.0` abgeglichen. Customer B bleibt unverändert. |
| Oracle-Verbindungen | Development, Customer A und Customer B in der Oberfläche erfolgreich getestet und aktiviert. Jedes Profil zeigt seine eigenen zwei Tabellen; der Login-Schema-Fallback wurde korrigiert. |
| Oracle-Baseline und Kundenkonfiguration | Neues Repository `oracle-repository-v3` nativ initialisiert, zwei Tabellen im Format 3 aufgenommen, Schema und Teamkonfiguration committet (`6aa185a`), Baseline `1.0.0` committet (`ffa4d8c`). Customer A und B mit eigenen Logins und Schema-Zuordnungen geprüft; Teamkonfiguration committet (`b8d1394`). |
| Oracle-Ausführungssperre | Fehlendes EXECUTE auf `SYS.DBMS_LOCK` blockierte die erste Baseline-Prüfung. Dieses gezielte Recht im isolierten Labor ergänzt; beide Baseline-Prüfungen danach erfolgreich. |
| Oracle-Migration und Rollout | Development-Spalte über den nativen SQL-Editor angelegt; `1.1.0` mit vollständig automatisch erzeugtem ADD, Betriebsplan und SQL-Nachprüfung committet (`fa9c267`). Customer A zunächst einzeln ausgerollt, Customer B danach erneut geplant und separat ausgerollt. Beide Planungen melden null Drift und die jeweilige tatsächliche Oracle-Identität; beide Wellen abgeschlossen. |
| Oracle-Snapshot-Portabilität | Neuer lesender Rust-Labortest prüft CUSTOMERS und ORDERS über drei getrennte Logins. Format-3-Definitionen sind nach Schema-Zuordnung identisch. Identity-Optionen bleiben sichtbar, interne Sequenznamen und redundante Standard-NOT-NULL-Constraints werden normalisiert. Format 2 behält seine bisherigen Identity-Metadaten. |
| Oracle-Kundentrennung | `USER` und `CURRENT_SCHEMA` für Customer B bestätigt. Zugriff von B auf `L8DB_CUSTOMER_A.CUSTOMERS` endet mit `ORA-00942`. |
| Abschlussübersicht | Nach den Oracle-Rollouts null offene Dateien, null Release-Entwürfe, null Ziele mit Aufgaben. Die Oberfläche zeigt „Keine offenen Aufgaben“ statt erneut eine erledigte Aufgabe als nächsten Schritt anzugeben. |
| Light Mode | Eingabefelder und Auswahllisten mit gemeinsamen UI-Primitiven und sichtbar kräftigeren Rahmen in der nativen Ansicht geprüft. |

Das PostgreSQL-Repository ist nach Release-Commit `fb5bddb` sauber. Die lesende Nachkontrolle bestätigt 20 Development-Kunden mit `active = true`, null Zeilen und die neue Pflichtspalte in Customer A sowie null Zeilen ohne neue Spalte in Customer B. Die Seed-Datei bleibt ein Development-Artefakt.

Das aktuelle Oracle-Team-Repository `oracle-repository-v3` ist nach Release-Commit `fa9c267` sauber. Die lesende Nachkontrolle bestätigt `ACTIVE NUMBER(1,0) NOT NULL DEFAULT 1` in Development, Customer A und Customer B; alle drei Kundentabellen enthalten weiterhin null Zeilen. Nach der ersten Welle war die neue Spalte ausschließlich in Development und Customer A vorhanden. Customer B wurde erst durch die ausdrücklich gestartete zweite Welle geändert. Das erste explorative Repository enthält eine uncommittete Format-2-Aufnahme und ist kein freigegebenes Release.

Die ergänzte Normalisierung erhält Identity-Generation, DEFAULT ON NULL und sämtliche gelesenen Identity-Optionen. Bereits verwaltete interne Sequenzen werden nicht automatisch entfernt. Format 2 bleibt kompatibel, und Oracle-Zeichenlängen werden im Backend nicht mehr doppelt angehängt. Der lesende Labortest ersetzt keinen Rollout-Nachweis; beide nativen Oracle-Wellen wurden anschließend zusätzlich vollständig ausgeführt und ihre Datenbankzustände geprüft.

Computer Use war zwischenzeitlich erneut durch `cgWindowNotFound` unterbrochen. Nach Wiederherstellung des sichtbaren Fensters wurde die private Dev-App mit dem aktuellen Backend neu gestartet und der native Ablauf abgeschlossen. Die Lab-Logins erhalten ausschließlich das zusätzliche Paketrecht für die verpflichtende Sperre; eine solche Vergabe in Produktion muss der DBA prüfen. Oracle empfiehlt als engere Alternative ein begrenzendes Wrapper-Package: [DBMS_LOCK Security Model](https://docs.oracle.com/en/database/oracle/oracle-database/26/arpls/DBMS_LOCK.html).

Technische Prüfungen des Nachtrags: TypeScript und Vite-Build bestanden; 96 gezielte Frontend-Tests sowie 17 Rust-Versionierungstests bestanden. Der neue lesende Oracle-Labortest bestand zusätzlich mit allen drei Logins. Biome und Clippy liefen ohne Fehler; vorhandene Warnungen bleiben. Der zuvor geprüfte Gesamtstand bestand mit 431 Rust-Tests und 98 ignorierten Laborszenarien. Im früheren vollständigen Frontend-Lauf gab es zwei Importfehler durch einen fehlenden `addPluginListener`-Export im kombinierten Tauri-Mock; die betroffenen Dateien bestanden isoliert mit neun Tests. `production:check` war an der parallel bearbeiteten Fenster-Capability `win-*` gescheitert. Diese fremden Änderungen gehören nicht zu diesem Änderungspaket.

Eine vorhandene Schutzfunktion oder ein Unit-Test allein gilt nicht als Nachweis eines produktionsreifen Sicherheitssystems. Im Labor besitzt der Development-Benutzer die PostgreSQL-Kontrolltabellen weiterhin selbst; damit ist die erforderliche Trennung privilegierter Rollen ausdrücklich nicht nachgewiesen.
