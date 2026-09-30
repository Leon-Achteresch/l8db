# Datenbank-Versionierung

Die Ansicht **Versionierung** verbindet ein lokales Git-Repository mit SQL-Datenbanken (PostgreSQL, Oracle, MySQL/MariaDB, SQL Server, SQLite, DuckDB, ClickHouse). Das Modell ist zustandsbasiert wie bei Redgate SQL Source Control, dbForge Source Control oder DataGrip-DDL-Mappings: Pro Objekt liegt eine Definitionsdatei im Repository. Releases, Kunden-Deployments und Development-Seeds gibt es für PostgreSQL und Oracle; bei den übrigen Familien sind die Tabs **Releases**, **Kunden** und **Seeds** ausgeblendet. Ein Git-Branch beschreibt einen Entwicklungsstand. Jede verbundene Datenbank hat unabhängig davon einen geprüften Release-Stand. Branch-Wechsel führen kein SQL aus.

Die [Erweiterung für den produktiven Betrieb](database-versioning-operations.md) beschreibt Release-Linien, Update-Regeln, Datenprüfungen, Sitzungs- und Zeitlimits, Oracle-Metadaten sowie die zugrunde liegende Web-Recherche und verbleibende Grenzen.

Das Git-Symbol oben rechts öffnet die zuletzt verwendete Ansicht. Der Umschalter im Kopf der Versionierung wechselt zwischen Seitenpanel und einem eigenen Tab im Arbeitsbereich. Entwürfe, Zielauswahl und geprüfte Rollout-Pläne bleiben dabei erhalten. Im Panel bleibt der bisherige Arbeitsbereich sichtbar; Transaktionspanel und Versionierung wechseln sich ab. Die Tabs **Übersicht**, **Branches**, **Änderungen**, **Releases**, **Kunden**, **Seeds** und **Aktivität** trennen den nächsten Arbeitsschritt, Git-Verlauf, Dateien, Release-Erstellung, Rollouts und Beispieldaten. Alle Auswahllisten sind durchsuchbar und per Tastatur bedienbar.

Die **Übersicht** zeigt offene Git-Dateien, Release-Entwürfe und Ziele mit Aufgaben. Sie führt von der Schema-Aufnahme über Baseline und Migration zu Kundenzuordnung und Rollout. Fehlende Baselines und ungeklärte Deployments werden als konkrete Aufgaben aufgeführt. Nur commitete Releases derselben Vorgängerkette zählen als verfügbare Updates.

Das Badge zählt geänderte Git-Dateien, einen ungespeicherten Entwurf sowie Ziele mit ausstehenden Releases, fehlender Baseline oder ungeklärtem Deployment. Gezählt werden nur Releases derselben Vorgängerkette, die lokal unverändert vorliegen. Der Repository-Status wird bei Fensterfokus und alle 15 Sekunden aktualisiert; während Bearbeitung und laufender Aktionen pausiert die Aktualisierung. Dabei werden keine Datenbankabfragen oder automatischen Remote-Fetches ausgelöst. Entwürfe, Zielauswahl und geprüfte Rollout-Pläne bleiben beim Schließen des Panels erhalten.

## Einzelne Datenbank

1. Repository öffnen oder Git im gewählten Ordner initialisieren. Git muss installiert und `user.name`/`user.email` eingerichtet sein.
2. Mit der aktiven SQL-Verbindung ein Projekt anlegen.
3. In **Änderungen** eine Entwicklungsdatenbank (Verbindung, Datenbank, Schema) verknüpfen. Die Verknüpfung gilt pro Git-Branch auf diesem Rechner (`localStorage`), weil Verbindungs-IDs lokal sind. Ein unter **Branches** zugeordnetes Development-Ziel wird als Quelle angeboten.
4. **Vergleichen** liest alle unterstützten Objekte des Schemas und zeigt pro Objekt, ob es in der Datenbank abweicht, neu ist oder fehlt, jeweils mit Diff Repository ↔ Datenbank. Ausgewählte Objekte mit **Ins Repository übernehmen** speichern: Neue Objekte werden in `project.json` aufgenommen, in der Datenbank fehlende Objekte samt Datei entfernt. Für die Gegenrichtung öffnet **Repository-Stand im Editor** die gespeicherte Definition als SQL-Tab; ausgeführt wird dabei nichts automatisch.
5. Unter **Repository** die Dateien prüfen, bearbeiten und gezielt oder mit **Alle für Commit** committen. Oracle-Packages liegen getrennt als `.pks` und `.pkb` vor.

Ab hier nur PostgreSQL und Oracle:

6. Einen Ausgangsrelease ohne Migration anlegen und dessen Manifest committen.
7. Unter **Kunden** eine Entwicklungs-, Test- oder Produktionsdatenbank mit Kunde und Umgebung als Ziel hinzufügen. Die Baseline wird nur zugeordnet, wenn ihre verwalteten Definitionen tatsächlich zum Release passen.
8. Auf einem Feature-Branch arbeiten. Den nächsten Release mit Vorgänger vorbereiten: **Migration automatisch erzeugen** erstellt SQL aus dem Unterschied zum Vorgänger. Nicht unterstützte Änderungen werden einzeln aufgeführt und verlangen manuelle Ergänzung und ausdrückliche Prüfung. **Release speichern und committen** übernimmt Projekt, Objektdateien und das neue Release-Manifest gezielt in Git; ein Entwurf lässt sich auch ohne Commit speichern.
9. Ziele und Zielrelease auswählen, mit **Planen** das tatsächlich für diese Ziele verwendete SQL prüfen und den Release-Namen zur Ausführung eingeben.

Der SQL-Vorschlag unterstützt neue Tabellen, Spaltenänderungen, Sequenzen und die vorhandenen Vergleichsoperationen für Views und Programmeinheiten. Neue Sequenzen werden vor Tabellen angelegt, neue Fremdschlüssel nach den Tabellen. Entfernen von Objekten oder Spalten muss ausdrücklich freigegeben werden. Komplexe Constraints, Trigger, Identitätsspalten und fachliche Datenmigrationen können manuelle SQL-Ergänzungen benötigen. Die Vorschau ersetzt keine Prüfung von Datenmigrationen, Abhängigkeiten oder Betriebsanforderungen. Gespeicherte Tabellendefinitionen sind Vergleichsmetadaten, kein vollständiger Datenbank-Dump. Von einem commiteten Release führt **Rollout planen** direkt zur Zielauswahl mit diesem Release.

Fetch, Fast-forward-Pull und Push verwenden `origin` und die vorhandene Git-Authentifizierung. Interaktive Passwortabfragen werden nicht geöffnet. Push und Pull verlangen einen sauberen Arbeitsbaum; Force-Push wird nicht angeboten.

## Branches und Swimlanes

**Branches** zeigt die letzten 120 Commits aller lokalen und bereits abgerufenen Remote-Branches als Swimlanes mit Verzweigungen und Merge-Verbindungen. Branches können gewechselt und von einer gewählten lokalen Basis angelegt werden. Ein echter Git-Merge übernimmt den Quell-Branch in den aktiven Branch. Er verlangt einen sauberen Arbeitsbaum und bricht bei Konflikten ab; danach bleibt der vorherige Stand erhalten. Der vorhandene Drei-Wege-Dateieditor dient zur gezielten Konfliktauflösung. Ein Merge darf bestehende Release-Manifeste aus der gemeinsamen Basis nicht verändern oder entfernen.

Zusammengeführte lokale Branches lassen sich ohne Force-Delete löschen. Aktiver Branch, Hauptbranches, bekannter `origin`-Standardbranch und Branches mit nicht übernommenen Commits bleiben geschützt. Das Development-Ziel eines Branches wird lokal pro Projekt und Branch gespeichert. Diese Zuordnung verknüpft eine vorhandene Datenbank oder ein vorhandenes Schema; Git legt keine Datenbankkopie an.

## Development-Seeds

Unter **Seeds** entstehen reproduzierbare Beispieldaten für eine gewählte Tabelle. Der bestehende Datengenerator ermittelt passende Generatoren; Spalten, Zeilenanzahl und Zufalls-Seed sind bearbeitbar. Ein Export umfasst bis zu 1.000 Zeilen pro Generierung und erzeugt vollständiges SQL, ohne Daten einzufügen. Alternativ lässt sich eigenes Seed-SQL bearbeiten. Die Datei `database/seeds/seed.sql` wird im aktiven Branch gespeichert und unter **Änderungen** mit Git commitet.

Der Ablauf folgt dem [Supabase-Seeding-Modell](https://supabase.com/docs/guides/local-development/seeding-your-database): Schema-Migrationen zuerst, Seed-Daten danach, getrennt als SQL-Datei. Für die Generierung nutzt l8db die vorhandenen synthetischen Generatoren; es benötigt keine zusätzliche Node-Abhängigkeit aus [Supabase Community Seed](https://github.com/supabase-community/seed).

Erstellen, Speichern und Ausführen sind auf `main`, `master`, `trunk`, `production`, `prod` und Detached HEAD gesperrt. Das Backend sperrt die Ausführung zusätzlich auf dem bekannten `origin`-Standardbranch. Ausführungsziele müssen als Nicht-Produktion gekennzeichnet sein und eine geprüfte Baseline besitzen. Gespeicherte SQL-Prüfsumme, aktueller Branch, physisches Ziel, gemeinsame Produktionskennzeichnung, Update-Pause und Operator-Berechtigung werden erneut geprüft. Eine erforderliche Deployment-Freigabe wird nicht durch Seeds umgangen.

Zulässig sind ausschließlich schemaqualifizierte `INSERT INTO … VALUES` mit festen Werten in Anwendungstabellen des gewählten Schemas. Abfragen, Funktionen, DDL, Kontrolltabellen und weitere Operationen sind ausgeschlossen. Die Ausführung erfolgt transaktional und wird mit Branch und Prüfsumme protokolliert. Der Name des Development-Ziels muss vor der Ausführung eingegeben werden. Seeds ergänzen vorhandene Daten; erneutes Ausführen ist kein Reset und kann bei eindeutigen Schlüsseln fehlschlagen.

## Mehrere Kunden mit unterschiedlichen Versionen

Ein Repository enthält die Releases eines Produkts. Beispielsweise kann Kunde A auf `v1`, Kunde B auf `v2` und Kunde C weiterhin auf `v1` stehen. Beim Zielrelease `v3` plant l8db für A die Schritte `v2 → v3` und für B nur `v3`. Nicht ausgewählte Kunden bleiben auf ihrem bisherigen Stand.

Ein Kunde bündelt mehrere Umgebungen, beispielsweise Development, Test und Produktion. Jede Umgebung verweist auf eine eigene Verbindung, Datenbank oder ein abweichendes Schema, auch auf unterschiedlichen Servern. Die Kundenansicht zeigt Server, Datenbank/Schema, aktuellen Release, offene Updates und Blockaden und erlaubt Auswahl pro Kunde oder Ziel. Bestehende Ziele bleiben kompatibel und werden anhand ihres Namens gruppiert. Kunde, Umgebung und Anzeigename können nachträglich bearbeitet werden; das Entfernen einer lokalen Zuordnung löscht keine Datenbank.

Über **Update-Regeln** lassen sich eine Release-Linie, ein maximal freigegebener Release und eine Pause setzen. Die Vorschau zeigt die Schritte und das SQL jedes Ziels. Vor dem ersten Schreibzugriff werden alle ausgewählten Ziele erneut geprüft. Mehrere ausgewählte Ziele werden nacheinander aktualisiert; beim ersten Fehler endet der Rollout. Bereits erfolgreiche Ziele und Releases behalten ihren neuen Stand.

Unterschiedliche Versionsstände benötigen keine dauerhaften Kundenbranches. Absichtlich unterschiedliche Programmlogik benötigt dagegen ausdrücklich gepflegte Varianten. Ein abweichender Package-Body wird als Drift angezeigt und nicht ungeprüft mit dem Produktstand überschrieben.

Für solche Varianten unterstützt der Dateieditor einen Drei-Wege-Merge: gemeinsamer Basis-Commit, neuer Produkt-Commit und aktueller Kundenentwurf. Konflikte bleiben sichtbar und müssen aufgelöst werden. Das Ergebnis kann als eigener Release mit passender Vorgängerkette gepflegt werden. Ein Kundenrelease darf keine Migrationen aus einer fremden Vorgängerkette überspringen. l8db übernimmt keine automatische fachliche Zusammenführung kundenspezifischer Logik.

## Speicherung und Prüfungen

- `database/project.json`: Projekt und explizit verwaltete Objekte.
- `database/objects/`: lesbare Definitionen; Packages mit separater Specification und Body.
- `database/releases/<id>.json`: vollständiger erwarteter Objektstand, Vorgänger und Migrationen mit SHA-256-Prüfsummen.
- `database/seeds/seed.sql`: separat versionierte Development-Daten mit INSERT-Anweisungen.
- Git-Common-Directory, `l8db-targets.json`: lokale Verbindungszuordnungen und detaillierte Deployment-Ereignisse, gemeinsam für Worktrees. Zugangsdaten werden nicht exportiert.
- Im Zielschema, `L8DB_VERSIONING_STATE`: gemeinsamer Release-Hash, Status und Deployment-Sperre pro Projekt. Die Baseline-Zuordnung legt diese Tabelle an und benötigt entsprechende Rechte.

Ein gespeicherter Zielrelease verweist auf einen konkreten Git-Commit. Bereits commitete Release-Dateien können über die Oberfläche nicht überschrieben werden. Extern manipulierte Manifest-Prüfsummen, veränderte Ausgangsreleases, fehlende Vorgänger und Zyklen werden abgewiesen.

Vor dem Deployment werden Datenbankdefinitionen erneut gelesen und mit der Baseline verglichen. Der freigegebene Plan ist an Commit, Ziel und konkretes SQL gebunden. Eine atomare Datenbank-Sperre verhindert zwei gleichzeitige Deployments desselben Projekts auch aus verschiedenen Repository-Kopien. Dateizugriffe verwenden zusätzlich eine Prozess-übergreifende Sperre und vergleichen beim Speichern den erwarteten vorherigen Inhalt.

## Fehler und Wiederaufnahme

PostgreSQL führt alle Migrationen eines Releases in einer gemeinsamen Transaktion aus, einschließlich seiner SQL-Nachprüfungen und Aktualisierung des gemeinsamen Release-Stands. Ein SQL- oder Nachprüfungsfehler rollt diesen Release zurück. Zuvor abgeschlossene Releases bleiben angewendet. Nicht transaktionale Operationen wie `CREATE INDEX CONCURRENTLY` werden in diesem Modus abgewiesen. Die zusätzliche strukturelle Snapshot-Prüfung erfolgt nach dem Commit; eine dort festgestellte Abweichung kann bereits angewendetes SQL betreffen.

Oracle führt Anweisungen einzeln aus und stoppt bei Fehlern. DDL kann bereits dauerhaft gespeichert sein. Nach der Ausführung werden verwaltete beziehungsweise neu ungültige Objekte und der erwartete Objektstand geprüft. Package-Specification und Body werden als vollständige Programmeinheiten ausgeführt.

Abbruch, Verbindungsfehler und unvollständige Deployments bleiben als ungeklärt markiert. Es gibt keinen automatischen Retry und keinen vorgetäuschten Oracle-Rollback. Zur Wiederaufnahme tatsächliches Schema und Daten prüfen, gegebenenfalls reparieren, sicherstellen, dass kein Deployment mehr läuft, und über **Stand abgleichen** den passenden Release ausdrücklich bestätigen. Der Schema-Vergleich kann die fachliche Korrektheit bereits ausgeführter Datenänderungen nicht beweisen.

## Umfang

Der verwaltete Umfang ist ausdrücklich die Objektliste des Projekts. Die Schema-Aufnahme übernimmt die vom jeweiligen Adapter angebotenen Vergleichstypen, beispielsweise Tabellen, Views, Routinen, Packages und Sequenzen. Unverwaltete Objekte werden nicht gelöscht. Tabellenvergleiche verwenden Spalten, Constraints, Indizes und Trigger aus dem bestehenden Adapter. Grants, RLS-Policies, alle herstellerspezifischen Speicheroptionen und produktive Daten sind kein vollständiger Bestandteil dieses Snapshots.

Schema-Zuordnung verlangt einen einzelnen Quellschema-Namen je Release. Der Scanner erhält Literale und Kommentare. Nicht sicher abbildbare PostgreSQL-Dollar-Strings werden abgewiesen. Dynamisches SQL muss ausdrücklich für das Ziel geprüft und geschrieben werden.

Es gibt keine automatische Datenzusammenführung, Datenbank-Klonung, Neon-/Supabase-Cloud-Provisionierung oder automatische Down-Migration. Git verwaltet Definitionen und Release-Artefakte; die Ausführung erfolgt bewusst gegen ausgewählte Datenbankziele.

## Tests

```sh
bun test tests/versioning.test.ts
bun test tests/versioning-workflow.test.ts tests/versioning-drift.test.ts
cargo test --manifest-path src-tauri/Cargo.toml versioning::tests --lib
cargo test --manifest-path src-tauri/Cargo.toml seed --lib
```

Die Live-Tests verwenden echte Git-Repositories, PostgreSQL und Oracle. Eine explizit aktivierte, ignorierte Rust-Testfunktion stellt ausschließlich für das lokale Labor eine HTTP-Brücke bereit. Sie wird nicht in den normalen Anwendungsbetrieb eingebunden. Sie verlangt isolierte Loopback-Datenbanken auf Ports 55440 und 55441 und beschränkt Git-Zugriffe auf das Laborverzeichnis.

Die Datei aus `L8DB_VERSIONING_LAB` ist eine nur für den aktuellen Benutzer lesbare JSON-Datei mit `root`, `repo`, `postgresUrl` und `oracleUrl`. Zugangsdaten gehören weder ins Repository noch in Testausgaben. PostgreSQL verwendet die isolierten Datenbanken `l8db_versioning_dev`, `l8db_versioning_a`, `l8db_versioning_b` und `l8db_versioning_edge`; Oracle verwendet `L8DB_VCS_DEV`, `L8DB_VCS_A` und `L8DB_VCS_B` mit Tablespace-Quota. Die Szenarien setzen ausschließlich diese Testobjekte zurück.

Bei laufendem Vite auf Port 1420 und vorbereiteten Labordatenbanken:

```sh
L8DB_VERSIONING_LAB=/path/to/private-lab.json cargo test --manifest-path src-tauri/Cargo.toml versioning_browser_bridge --lib -- --ignored --nocapture
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-live.test.ts tests/versioning-oracle-live.test.ts
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-operations-live.test.ts
```

Abgedeckt sind unter anderem unterschiedliche Kundenstände, veraltete Freigaben, konkurrierende Deployments, direkte Schemaänderungen, Schreibschutz, transaktionaler PostgreSQL-Rollback, Oracle-Teilzustände, Stoppen nach Fehlern, Schema-Zuordnung, getrennte Package-Dateien, konfliktbehaftete und konfliktfreie Drei-Wege-Merges mit großen Quellen, unveränderliche Releases, Worktrees, Remote-Synchronisierung und Dateipfadgrenzen. Die Szenarien lassen sich außerdem über die T3-Browsersteuerung ausführen.

Validierung des Feature-Branches am 20.09.2026: 970 Frontend-Tests und 143 Rust-Tests bestanden; drei Live-Szenarien mit PostgreSQL/Oracle in Chromium beziehungsweise WebKit sowie zwei Produktions-/Sandbox-Browsertests bestanden. TypeScript, Vite-Produktionsbuild, Biome und Clippy liefen ohne Fehler. Bestehende Lint- und Bundle-Warnungen bleiben bestehen. Über T3 wurden zusätzlich Rollout-Vorschau, tatsächliche Ausführung, Drift-Anzeige, manueller Standabgleich und Schutz ungespeicherter Release-Entwürfe geprüft. Die überarbeitete Seitenleiste wurde in Chromium und WebKit mit Badge-Aktualisierung, gegenseitigem Panel-Wechsel, erhaltenen SQL- und Release-Entwürfen, Rollout-Plan beim Wiederöffnen, Tastaturauswahl, dunklem Farbschema, reduzierter Bewegung und schmalem Fenster geprüft. Backend-Tests beziehen sich auf den vorangegangenen Implementierungsstand; die anschließende Überarbeitung verändert ausschließlich Frontend und Dokumentation.

Im abschließenden kombinierten Live-Lauf erreichte WebKit einmal das Zeitlimit von 120 Sekunden. Der anschließende isolierte WebKit-Lauf bestand unverändert in 18 Sekunden; die beiden vorangegangenen Browserläufe waren ebenfalls erfolgreich.

Validierung der Erweiterung am 30.09.2026: 1.439 Frontend-Tests und 423 Rust-Tests bestanden; 197 Frontend- und 98 Rust-Laborszenarien waren deaktiviert beziehungsweise ignoriert. TypeScript, Vite-Build, Biome und Clippy liefen ohne Fehler mit bestehenden Warnungen. Neue Tests prüfen Git-Forks und echte Merges, Konfliktabbruch, sichere Branchlöschung, unveränderliche Releases, automatische Migrationen einschließlich Fremdschlüsselreihenfolge, geschützte Seed-Branches und INSERT-Scope. Ein SQLite-Test prüft die vollständige, reproduzierbare Seed-Erzeugung und bestätigt, dass der Export selbst keine Zeilen schreibt. Die T3-Funktionsprüfung mit simuliertem Tauri-Transport deckt Branchwechsel, Swimlanes, Seed-Erzeugung, Speichern und Ausführen, die Hauptbranch-Sperre, erhaltene SQL-Entwürfe beim Panel-/Tab-Wechsel sowie Release-Erstellung mit direktem Übergang zur Rollout-Auswahl ab. Diese Erweiterung wurde nicht gegen echte PostgreSQL-/Oracle-Kundenziele ausgerollt; das isolierte Live-Labor stand für diesen Lauf nicht zur Verfügung.
