# Datenbank-Versionierung im Betrieb

Recherche und Implementierungsstand: 21.09.2026. Dieses Dokument ergänzt [die Bedienungsanleitung](database-versioning.md). Die folgenden Entscheidungen sind unsere Ableitung für l8db aus den verlinkten Quellen und aus den Live-Tests.

## Was eine produktiv genutzte Datenbank ausmacht

Eine Datenbank wird gleichzeitig von alten und neuen App-Versionen, Hintergrundjobs, Reports, Importen und Administratoren benutzt. Ihr Schema kann unverändert sein, während Datenmenge, Datenqualität und Berechtigungen je Kunde stark abweichen. Deshalb sind vier Zustände getrennt zu behandeln:

| Zustand | Verwaltung in l8db |
| --- | --- |
| Geplante Definitionen und Programmlogik | Git-Dateien, Branches, Vergleiche; Oracle-Specification und Body getrennt |
| Geprüfter Weg zwischen Ständen | Unveränderliche Releases mit SQL, Prüfsummen, Betriebsplan und Datenprüfungen |
| Tatsächlich angewendeter Stand | Datenbank-Ledger, dauerhaftes Datenbankjournal und lokale Anzeige pro Ziel |
| Laufende Geschäftsdaten und Sessions | Weiterhin in der Datenbank; keine automatische Git-Zusammenführung |

Ein Branch-Wechsel darf weder Rechnungen zurücksetzen noch ungeprüft Produktions-DDL auslösen. Ein Git-Revert ist kein Daten-Restore. Seeds gehören zu reproduzierbaren Testumgebungen; Backups, Restore-Tests und Anonymisierung benötigen einen eigenen Ablauf.

## Modell 1: Eine Produktdatenbank, mehrere Entwicklungsstände

Entwicklung erfolgt auf einem Feature-Branch gegen eine isolierte Testdatenbank. Der Release enthält sowohl den erwarteten Objektstand als auch den konkreten Änderungspfad. Vor der Freigabe wird derselbe Pfad mit repräsentativen Daten und parallel laufender Anwendung getestet. In Produktion wird die Migration angewendet; die Testdatenbank ersetzt keine laufende Produktionsdatenbank.

Neons vollständiges [Beispiel für Branches und Preview-Umgebungen](https://neon.com/blog/branching-with-preview-environments) zeigt die Kopplung von Preview-App, separatem Datenbank-Branch und späterem Anwenden der Migrationen auf dem Hauptbranch. Für sensible Bestände sind kontrollierte Testdaten nötig; l8db provisioniert selbst keine Neon-Branches.

Supabase trennt ebenfalls [isolierte Branch-Umgebungen](https://supabase.com/docs/guides/deployment/branching) von der produktiven Datenbank. Die Anleitung [Database Migrations](https://supabase.com/docs/guides/deployment/database-migrations) erklärt insbesondere das Zusammenspiel von Git-Dateien, angewendeter Migrationshistorie, direkter Remote-Änderung und Reparatur der Historie. Ein Reparatureintrag führt kein fehlendes SQL nachträglich aus. Daraus folgt für l8db: Drift sperrt Deployments; eine manuelle Baseline ist eine ausdrückliche Bestätigung des tatsächlichen Stands.

## Modell 2: Ein Produkt, viele unterschiedlich versionierte Kundendatenbanken

Ein älterer Kunde benötigt alle fehlenden Schritte seiner Vorgängerkette. Ein bereits aktueller Kunde wird übersprungen. Vor dem ersten Schreibzugriff müssen alle ausgewählten Kunden die Vorprüfung bestehen. Während der Ausführung stoppt der erste Fehler den verbleibenden Rollout; abgeschlossene Kunden werden nicht automatisch zurückgesetzt.

Die ausführliche Flyway-Anleitung [Rolling out updates from a single schema to multiple production databases](https://documentation.red-gate.com/flyway/deploying-database-changes-using-flyway/rolling-out-updates-from-a-single-schema-to-multiple-production-databases) behandelt Baselines, unveränderliche Artefakte, Unterschiede in Zielkonfigurationen, Rollout-Reihenfolge und getrennte Prüfungen von Historie und Schema. Für l8db übernehmen wir daraus den expliziten Stand je Ziel und eine Vorprüfung der gesamten Auswahl.

In l8db gelten jetzt zusätzlich:

- `track` bezeichnet die fachliche Release-Linie, beispielsweise `main` oder `kunde-acme`. Das ist unabhängig vom Git-Branch. Ein Hauptlinien-Release kann Ausgangspunkt einer Variante sein; ein Kundenrelease darf seine Linie anschließend nicht stillschweigend verlassen.
- Eine eigene Baseline pro neuer Variante erlaubt den Einstieg mit bereits abweichenden Beständen. Sie ersetzt keine Prüfung oder Zusammenführung dieser Unterschiede.
- `pinnedRelease` begrenzt Updates auf einen freigegebenen Nachfolger. `paused` hält Updates für ein Ziel an. Beides wird im Plan und unmittelbar vor der Ausführung berücksichtigt.
- Einstellungen stehen im Popover des Ziels unter **Update-Regeln** und werden verbindlich aus der Datenbank geladen. Der Rollout startet standardmäßig mit einer Canary-Datenbank; alternativ sind Wellen mit bis zu 5, 10 oder 1.000 geprüften Zielen auswählbar. Nach jeder Welle werden Anwendung und Betrieb geprüft, verbleibende Ziele neu geplant und ausdrücklich gestartet.
- Doppelte Verbindungsaliase zur selben ermittelten Datenbank und demselben Schema werden innerhalb der Auswahl abgewiesen. Ein anderer Endpunkt, Datenbankkontext oder eine Oracle-Edition erfordern einen ausdrücklichen Standabgleich. Ein durch die gemeinsame Policy freigegebener anderer DB-Benutzer kann denselben physischen Stand verwenden; der konkrete Rollout und seine Freigabe bleiben an seine Benutzeridentität gebunden.

Eine bewusste Kundenvariante ist kein beliebiges Überspringen von Migrationen. Gemeinsame Produktkorrekturen werden auf der Variantenlinie geprüft übernommen. Dynamische Kunden-Sonderfälle in einem riesigen SQL-Skript bleiben schwer überprüfbar; die gewählte Linie und ihre Vorgänger sind dagegen sichtbar.

## Kompatibilität, Backfills und laufende Anwendungen

Der Artikel [Shared-Database Blue-Green Deployments in Practice](https://www.red-gate.com/hub/product-learning/flyway/shared-database-blue-green-deployments-in-practice/) erklärt vier konkrete Möglichkeiten für Übergangsphasen: stabile Schnittstellen, parallele Strukturen, Dual-Writes und Synchronisierung in der Datenbank. Die entscheidende Bedingung ist, dass alte und neue Anwendungen während des Übergangs korrekt arbeiten. Der abschließende Abbau erfolgt erst nach diesem Zeitraum.

Für l8db sind `expand`, `backfill`, `contract` und `custom` explizite Release-Phasen. `compatibility` und `notes` beschreiben den vorgesehenen Anwendungsbetrieb. Produktionsziele benötigen im Zielrelease einen versionierten Betriebsplan und mindestens eine Nachprüfung. Erkannte inkompatible Änderungen im gesamten Updatepfad verlangen einen Wartungsplan. Ältere Zwischenreleases bleiben ausführbar, ihre fehlenden Betriebsangaben werden im Gesamtplan angezeigt; der Zielrelease muss den gesamten ausgewählten Pfad abdecken.

Beispiel: Eine neue Pflichtspalte wird zunächst nullable hinzugefügt. Neue App-Versionen schreiben beide Darstellungen. Ein separat fortsetzbarer Backfill füllt alte Datensätze. Eine Prüfung weist nach, dass keine Lücken mehr existieren. Erst danach werden alte Leser abgeschaltet und Pflichtbedingung beziehungsweise Entfernung als eigener Release ausgerollt.

Große Backfills sind keine minutenlang blockierende Einmalmigration: Batches, stabile Schlüssel, Fortschrittsmarken, Wiederaufnahme und Lastgrenzen gehören in einen eigenen Job. l8db kennzeichnet Datenänderungen und speichert den Betriebsplan, enthält aber noch keinen Backfill-Jobrunner.

## Datenprüfungen statt bloßer Schema-Gleichheit

Liquibase beschreibt in [What are preconditions?](https://docs.liquibase.com/secure/user-guide-5-1/what-are-preconditions) den Nutzen ausführbarer Bedingungen vor Änderungen. Daraus übernehmen wir das Prinzip, einen ungeeigneten Datenzustand aktiv zu erkennen und anzuhalten.

Unter **Release vorbereiten → Betriebsplan und Prüfungen** können Vor- und Nachprüfungen angelegt werden. Jede besteht aus einer benannten SELECT-Abfrage, einem erwarteten skalaren Textwert und einer SQL-Prüfsumme. Beispielsweise liefert `SELECT COUNT(*) FROM invoices WHERE amount < 0` den erwarteten Wert `0`. Kein Treffer, mehrere Zeilen, mehrere Spalten, NULL, ein falscher Wert oder ein Abfragefehler stoppen die Ausführung. Zurückgegebene Kundenwerte werden nicht in Fehlermeldungen oder im Deployment-Verlauf gespeichert.

Die erste ausstehende Vorprüfung läuft bereits bei der Planung in einer separaten Lesetransaktion. Vorbedingungen späterer Releases können von vorherigen Migrationen abhängen und werden erst nach ihren jeweiligen Vorgängern geprüft. Jede Vorprüfung wird in der Ausführungssitzung wiederholt. PostgreSQL führt Daten-Nachprüfungen und den strukturellen Soll/Ist-Vergleich auf derselben Sitzung vor Commit und Ledger-Fortschreibung aus. Auch aus dem Manifest entfernte Objekte müssen im Datenbankkatalog tatsächlich fehlen. Oracle verwendet für einen Release dieselbe Sitzung; noch offene DML wird bei Fehlern zurückgerollt. Ausgeführte Oracle-DDL kann bereits dauerhaft sein.

Prüfungen müssen fachlich sinnvoll sein. `SELECT 1` beweist keine erfolgreiche Datenübertragung. SELECT-Funktionen müssen seiteneffektfrei sein; insbesondere Oracle-Autonomous-Transactions und externe Funktionsaufrufe sind kein zulässiger Ersatz für eine reine Datenprüfung. Die Abfrageprüfung ist keine vollständige SQL-Sandbox. Concurrent Writes werden durch eine Vorprüfung allein ebenfalls nicht ausgeschlossen; geeignete Constraints, Sperren und kompatible Anwendungslogik bleiben nötig.

## Zeitlimits, Sitzungen und Freigaben

Die PostgreSQL-Dokumentation zu [Client Connection Defaults](https://www.postgresql.org/docs/current/runtime-config-client.html) unterscheidet `lock_timeout`, `statement_timeout`, Suchpfad und Row-Level Security. Die [ALTER TABLE-Referenz](https://www.postgresql.org/docs/current/sql-altertable.html) beschreibt außerdem die Sperr- und Prüfanforderungen einzelner Änderungen. Diese Eigenschaften sind entscheidend, wenn eine Migration auf echten Tabellen statt auf einem leeren Testschema läuft.

In l8db gelten standardmäßig 5 Sekunden Sperrwartezeit und 60 Sekunden SQL-Zeitlimit. Releases können begrenzte Werte festlegen. PostgreSQL verwendet ein festes Suchschema sowie `row_security = off`: Wenn eine Policy die Sicht eines nicht privilegierten Benutzers einschränken würde, soll eine Datenprüfung fehlschlagen, statt unbemerkt nur einen Teil der Zeilen zu prüfen. Bei mehreren Quellschemas verlangt der PostgreSQL-Suchpfad qualifizierte Anweisungen. Oracle benötigt genau ein explizites Zielschema und setzt dessen `CURRENT_SCHEMA`; sein Treiber-Zeitlimit gilt pro Datenbankaufruf, nicht als garantierte Gesamtlaufzeit des Releases. Globale Treiber- oder Serverlimits können strenger sein.

Migrationen dürfen die verwaltete Sitzungssteuerung und die l8db-Historie nicht verändern. Freigaben binden Ziel, ermittelten Datenbankkontext, Release-Kette, SQL, Betriebsplan und Zielregeln. Sie verfallen nach 15 Minuten. Historische Releases werden aus dem Dateibaum ihres konkreten Git-Commits gelesen; ein unfertiger neuer Entwurf im Arbeitsbaum verändert diesen Bestand nicht. Bereits angewendete Vorfahren werden auf nachträgliche Änderungen geprüft, und Migrations-IDs dürfen sich innerhalb einer ganzen Vorgängerkette nicht wiederholen.

## Oracle: Große Packages und identische Kundenschemas

Oracle erklärt in [Package State](https://docs.oracle.com/en/database/oracle/oracle-database/19/lnpls/package-state.html), warum eine neu kompilierte Package-Body-Version bestehende Session-Zustände verwerfen und ORA-04068 verursachen kann. Deshalb zeigt l8db dieses Risiko auch dann an, wenn die Quelle sauber kompiliert. Der Betriebsplan muss unter anderem den Umgang mit Connection-Pools und alten Sessions beschreiben.

Die vollständige Anleitung [Using Edition-Based Redefinition](https://docs.oracle.com/en/database/oracle/oracle-database/19/adfns/editions.html) beschreibt isolierte Code-Editionen, Editioning Views und Crossedition Trigger. Tabellen werden durch eine neue Edition nicht automatisch zu unabhängigen Datenkopien. l8db bindet den beobachteten Editionskontext an die Freigabe, provisioniert aber keinen EBR-Rollout und schaltet keine Anwendungssessions um. Mehrere Editionen desselben Projekts mit gemeinsamem nicht editioniertem Ledger werden nicht als unabhängige Release-Ziele angeboten.

Die [Oracle-COMMIT-Referenz](https://docs.oracle.com/en/database/oracle/oracle-database/19/sqlrf/COMMIT.html) erläutert implizite Commits rund um DDL und die Unsicherheit bei verlorener Commit-Antwort. l8db bewahrt deshalb Fortschritt und ungeklärten Zustand, statt Oracle-DDL als zurückgerollt auszugeben oder automatisch erneut auszuführen. Vor jedem Oracle-Aufruf wird außerdem die bevorstehende Anweisung protokolliert: Fehlt ihre Erfolgsbestätigung, bleibt sie als möglicherweise wirksam sichtbar.

Neue Tabellenaufnahmen verwenden `metadataVersion: 2`. Bei Oracle werden nur nachweislich systemgenerierte Constraint-Namen in stabile Vergleichsnamen übersetzt. Fachliche Fremdschlüsselziele, Löschregeln, Validierung und Aktivierung bleiben Teil des Vergleichs. Explizit benannte Constraints behalten ihren Namen. Die sichtbaren `L8DB_GENERATED_…`-Namen sind Vergleichsplatzhalter und dürfen nicht als DDL ausgeführt werden; Migrationen müssen echte Namen verwenden oder sie kontrolliert aus dem Dictionary ermitteln.

Bestehende Aufnahmen ohne `metadataVersion` behalten ihr früheres Vergleichsformat. Für den Wechsel wird das Objekt explizit auf Version 2 gesetzt, neu aufgenommen und in einen neuen geprüften Release übernommen. Bereits commitete Releases werden nicht umgeschrieben.

Nach einer Tabellenänderung kann Oracle eine Lesetransaktion mit [ORA-01466](https://docs.oracle.com/en/error-help/db/ora-01466/) ablehnen, wenn deren Snapshot älter als die Definition ist. Die Prüfung bricht dann ab und schließt die Sitzung; eine Baseline wird nicht gesetzt. Nach Prüfung konkurrierender DDL muss die vollständige Planung beziehungsweise Baseline erneut ausgeführt werden. Der Labortest behandelt diesen Fall direkt nach dem Neuaufbau seiner Tabellen durch einen einmaligen neuen Baseline-Versuch und prüft zuvor den unveränderten Zielstand.

## Grenzen und nächste eigenständige Ausbaustufen

Die Schutzmechanismen gelten für den explizit verwalteten Umfang. Vollständige Grants, PostgreSQL-RLS-Policies, Scheduler-Jobs, Synonyme, externe Integrationen und alle physischen Speicherattribute sind weiterhin kein vollständiges Abbild einer Datenbank. Dafür braucht es zusätzliche versionierte Objekttypen mit eigenen Adaptern und Tests. Die aktuelle Definitionserfassung ist kein Ersatz für einen vollständigen Dump.

Der strukturelle PostgreSQL-Vergleich läuft innerhalb der Migrationstransaktion. Eine falsche Struktur verhindert deren Commit; bereits abgeschlossene Vorgängerreleases bleiben angewendet. Oracle-DDL kann schon wirksam sein, bevor die strukturelle Nachprüfung erfolgt. Ein Fehler markiert den Stand deshalb als ungeklärt, ohne einen DDL-Rollback zu behaupten.

Die Sperren koordinieren l8db-Ausführungen und Standabgleiche auf den verwalteten Schemas. Beliebige DBA-Sitzungen und andere Deployment-Werkzeuge müssen dieselbe Betriebskonvention einhalten oder organisatorisch ausgeschlossen werden. DNS-/Proxy-Topologien können dieselbe Datenbank hinter verschiedenen ermittelten Identitäten darstellen; die Alias-Erkennung ist kein globales Serverinventar.

Weitere eigenständige Ausbaustufen bleiben resumierbare Backfill-Jobs innerhalb eines Releases, vollständige Grants-/RLS-/Scheduler-/Synonym-Erfassung, repräsentative Clone-/Restore-Proben und eine eigene EBR-Orchestrierung. Ein Hintergrund-Rollout führt bestehende Release-Ketten aus; er macht eine beliebige UPDATE-Anweisung nicht automatisch idempotent oder in Batches fortsetzbar. Restore-Fähigkeit und fachliche Lastgrenzen müssen für das konkrete Produkt nachgewiesen werden.

## Gemeinsame Regeln, Freigaben und Rollen

Bei der ersten geprüften Baseline werden `L8DB_VERSIONING_POLICY`, `LOCKS`, `JOURNAL` und `APPROVALS` neben dem bisherigen `STATE`-Ledger angelegt. Bestehende Ziele aus älteren Versionen benötigen einmal einen ausdrücklichen Standabgleich. Der tatsächliche Datenbankbenutzer der Initialisierung wird erster Regeladministrator.

Die Policy enthält Release-Linie, Versionslimit, Pause, Produktionsschutz, optionale Rollout-Benutzer, Regeladministratoren und Freigeber. Änderungen benötigen die geladene Revision und einen Regeladministrator. Policy-Änderung und zugehöriger Journaleintrag werden gemeinsam committed. Eine zwischenzeitliche Änderung verwirft alte Planfreigaben; eine lokal manipulierte Kundenzuordnung überstimmt diese Regeln nicht. Ein Standabgleich benötigt ebenfalls einen Regeladministrator. Das Übernehmen einer bereits passenden, fertigen Baseline in eine neue lokale Zuordnung ist auch für freigegebene Operatoren möglich: Der vorhandene Ledger wird dabei weder zurückgesetzt noch fortgeschrieben. Vorhandene Steuerungstabellen müssen dafür nicht erneut angelegt werden.

Bei aktiviertem Vier-Augen-Prinzip wird der geprüfte Plan unter **Rollout prüfen → Freigabe anfragen** als unveränderliches, gehashtes Artefakt im Zieljournal abgelegt. Unter **Aktivität → Datenbankjournal** lädt ein zweiter Benutzer eine Verbindung zu derselben Datenbank, prüft das Artefakt und gibt es frei. Identifiziert wird `session_user` beziehungsweise Oracles `SESSION_USER`, nicht ein eingegebener Anzeigename. Ein gemeinsamer technischer Login kann daher keine Vier-Augen-Freigabe darstellen. Eigene Freigaben, fremde Artefakte, geänderte Policy-Revisionen und mehr als 15 Minuten alte Freigaben werden abgewiesen. Abgelaufene Freigaben können erneut abgegeben werden; die alten Einträge bleiben erhalten.

Diese Rollenprüfung ersetzt keine Datenbankberechtigungen. Für einen Unternehmensbetrieb werden separate DB-Konten benötigt: ein Bootstrap-/Regeladministrator, eingeschränkte Freigeber und ein kontrollierter Deployment-Account. Freigeber benötigen SELECT auf Policy/Journal/Approvals und INSERT auf Journal/Approvals, jedoch kein UPDATE/DELETE auf das Journal. Deployment benötigt Metadatenzugriff, die ausdrücklich freigegebenen DDL-/DML-Rechte, SELECT/UPDATE auf STATE und LOCKS sowie INSERT auf JOURNAL. Das Bootstrap-Anlegen der Tabellen erfordert entsprechende Schema-Rechte. Ein DB-Owner oder DBA kann Tabellen direkt verändern und wird durch die App nicht zu einem eingeschränkten Benutzer. Das Journal ist dauerhaft, aber gegen solche privilegierten Eingriffe nicht manipulationssicher; externe Audit-Archivierung bleibt erforderlich, wenn diese Bedrohung abgedeckt werden muss.

## Hintergrundausführung, Sperren und Wiederherstellung

Die gesamte gestartete Welle läuft als Rust-Hintergrundauftrag, einschließlich aller Releases eines Ziels. Neuladen oder Schließen des Panels beendet diesen Auftrag nicht. Vor dem ersten Ziel werden die ausgewählten Ziele erneut geprüft; pro Ziel werden Policy, Datenbankkontext, Vorgängerstruktur und Ledger nochmals validiert. Beim ersten Fehler stoppt die Welle. Ziele nach dem Fehler bleiben unangetastet.

Das Schließen des gesamten Desktop-Prozesses beendet dessen Executor. Es gibt keinen automatischen SQL-Retry nach einem Prozess- oder Verbindungsabbruch. Das Zieljournal speichert Start, Statement-ID und SQL-Hash vor einem Aufruf, bestätigte Ausführung, Commit-Anforderung und Commit-Bestätigung. Eine Statement-Bestätigung ist kein Beweis für einen Daten-Commit. Fehlt die Commit-Bestätigung, werden Ledger, tatsächliche Struktur und fachliche Daten geprüft, bevor ein Administrator den Stand abgleicht. Die `.git/l8db-targets.json` dient weiterhin der lokalen Zuordnung und Anzeige; das Datenbankjournal bleibt unabhängig davon erhalten.

Eine Koordinationssperre verhindert parallele Policy-Änderungen und Rollouts. Zusätzlich hält die tatsächliche SQL-Sitzung eine Ausführungssperre. Dadurch bleibt ein Abgleich gesperrt, wenn die Koordinationsverbindung verloren geht, aber SQL noch läuft. PostgreSQL verwendet [transaktionsgebundene Advisory Locks](https://www.postgresql.org/docs/18/functions-admin.html#FUNCTIONS-ADVISORY-LOCKS). Oracle verwendet [`SYS.DBMS_LOCK.REQUEST` mit `release_on_commit => FALSE`](https://docs.oracle.com/en/database/oracle/oracle-database/19/arpls/DBMS_LOCK.html): Diese Sitzungssperre überlebt DDL-Commits. Der Oracle-Deployment-Account benötigt dafür `EXECUTE ON SYS.DBMS_LOCK`; fehlt das Recht, wird abgebrochen. Es gibt keinen ungesicherten Fallback.

## Reproduzierbare Prüfungen

Zusätzlich zu den bestehenden Einzel- und Kundenszenarien testen `tests/versioning-operations-live.test.ts` und die zugehörige Fixture beide Anbieter gegen echte Datenbanken: gleiche Schemas mit unterschiedlichen Daten, Ganzgruppen-Vorprüfung, Zielpause und Versionslimit, Varianten, Endpunktwechsel, doppelte Aliase, Freigabeablauf, historische Commit-Dateibäume, explizites Schema, fehlgeschlagene Nachbedingungen, DML-Rollback, PostgreSQL-Sperr-/SQL-Zeitlimits und protokollierte Oracle-Teilzustände.

```sh
bun test tests/versioning.test.ts tests/versioning-safety.test.ts
L8DB_VERSIONING_LAB=/path/to/private-lab.json cargo test --manifest-path src-tauri/Cargo.toml enterprise_controls_and_executor_locks --lib -- --ignored --nocapture
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-enterprise-live.test.ts --test-name-pattern postgres
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-enterprise-live.test.ts --test-name-pattern oracle
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-operations-live.test.ts --test-name-pattern postgres
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-operations-live.test.ts --test-name-pattern oracle
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-oracle-live.test.ts
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-live.test.ts --test-name-pattern chromium
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-live.test.ts --test-name-pattern webkit
```

Laboraufbau und Testbrücke sind in [database-versioning.md](database-versioning.md#tests) beschrieben. Die Tests verändern ausschließlich die dort benannten isolierten Labordatenbanken und Schemas.

Enterprise-Ausbau, verifiziert am 21.09.2026:

| Prüfung | Ergebnis |
| --- | --- |
| Vollständige Frontend-Regression | 1004 bestanden, 69 umgebungsabhängige Tests übersprungen |
| Rust-Tests | 146 bestanden, 54 explizite Labortests ignoriert |
| Versionierungsregression einschließlich Identitätsbindung und Lesemodus | 61 bestanden |
| Echte PostgreSQL-/Oracle-Browsertests | Sieben einzeln gestartete Szenarien bestanden; anschließend zusätzlicher PostgreSQL-Test für unqualifiziertes CREATE TABLE bestanden |
| Native Enterprise-Integration | Beide Anbieter bestanden, einschließlich echter Zweitbenutzer und verlorener Commit-Antwort |
| T3-Tools mit realer Testbrücke | Alle 14 PostgreSQL- und 15 Oracle-Betriebsprüfungen bestanden; Freigabe-Tabs und ungespeicherte Regeländerungen über Hintergrund-Refresh geprüft |
| Produktionsbuild, Typecheck und Produktionskonfiguration | Bestanden |
| Produktions-CSP und Extension-Sandbox im Browser | Zwei Tests bestanden |
| Formatierung und Lint | Geänderte Frontend-Dateien sowie Rust-Formatierung bestanden; Clippy mit 16 bestehenden Warnungen abgeschlossen |

Die Live-Browsertests werden in getrennten Prozessen ausgeführt. Der Hintergrundtest startet eine Welle mit zwei Kundendatenbanken und lädt während ihrer Ausführung die Oberfläche neu. Auch der Ziel-Popover bleibt innerhalb der Fenstergrenzen und verwendet keine nativen Selects. PostgreSQL verwendet bei genau einem Zielschema dessen Suchpfad mit implizit vorrangigem `pg_catalog`; dadurch bleiben Systemfunktionen geschützt und ein unqualifiziertes CREATE TABLE landet im Kundenschema.

Die neuen Enterprise-Tests verwenden zusätzlich das isolierte PostgreSQL-Schema `l8db_enterprise_edge` in `l8db_versioning_edge`, das Oracle-Schema `L8DB_VCS_EDGE` und jeweils den Laborbenutzer `l8db_vcs_reviewer`. Sie prüfen echte getrennte Datenbankbenutzer, verweigerte Selbstfreigabe, abgelaufene und erneuerte Freigaben, manipulierte Artefakte, konkurrierende Regelrevisionen, fehlende Journal-Änderungsrechte, Unicode-CLOBs und Executor-Sperren nach Oracle-DDL. Ein Test injiziert nach einem tatsächlich ausgeführten PostgreSQL-Commit eine verlorene Antwort: Daten und Ledger sind committed, der Lauf bleibt gesperrt und SQL wird nicht automatisch wiederholt. Browsertests laden die Oberfläche während eines laufenden Rollouts neu und prüfen danach Daten, lokale Anzeige und dauerhaftes Journal.
