# Datenbank-Versionierung

Die Ansicht **Versionierung** verbindet ein lokales Git-Repository mit PostgreSQL- oder Oracle-Verbindungen. Ein Git-Branch beschreibt einen Entwicklungsstand. Jede verbundene Datenbank hat unabhängig davon einen geprüften Release-Stand. Branch-Wechsel führen kein SQL aus.

Das Git-Symbol oben rechts öffnet die Seitenleiste neben dem Arbeitsbereich. Wie beim Transaktionspanel bleibt der aktuelle Arbeitsbereich sichtbar; die beiden Panels wechseln sich ab. Die Tabs **Änderungen**, **Releases**, **Datenbanken** und **Aktivität** trennen Dateien, Release-Erstellung, Rollouts und Verlauf. Repository, Branches, Synchronisierung und zusätzliche Aktionen sind über Icon-Buttons mit Popovers erreichbar. Alle Auswahllisten verwenden die durchsuchbare, per Tastatur bedienbare Anwendungskomponente.

Das Badge zählt geänderte Git-Dateien, einen ungespeicherten Entwurf sowie Ziele mit ausstehenden Releases, fehlender Baseline oder ungeklärtem Deployment. Gezählt werden nur Releases derselben Vorgängerkette, die lokal unverändert vorliegen. Der Repository-Status wird bei Fensterfokus und alle 15 Sekunden aktualisiert; während Bearbeitung und laufender Aktionen pausiert die Aktualisierung. Dabei werden keine Datenbankabfragen oder automatischen Remote-Fetches ausgelöst. Entwürfe, Zielauswahl und geprüfte Rollout-Pläne bleiben beim Schließen des Panels erhalten.

## Einzelne Datenbank

1. Repository öffnen oder Git im gewählten Ordner initialisieren. Git muss installiert und `user.name`/`user.email` eingerichtet sein.
2. Mit der aktiven PostgreSQL- oder Oracle-Verbindung ein Projekt anlegen.
3. In **Änderungen** einzelne Objekte oder die unterstützten Objekte eines Schemas aufnehmen. Dateien vergleichen, bearbeiten und gezielt committen. Oracle-Packages liegen getrennt als `.pks` und `.pkb` vor.
4. Einen Ausgangsrelease ohne Migration anlegen und dessen Manifest committen.
5. Unter **Datenbanken** auch eine einzelne Entwicklungs-, Test- oder Produktionsdatenbank als Ziel hinzufügen. Die Baseline wird nur zugeordnet, wenn ihre verwalteten Definitionen tatsächlich zum Release passen.
6. Auf einem Feature-Branch arbeiten. Den nächsten Release mit Vorgänger und geprüftem Migrations-SQL erstellen und committen.
7. Ziele und Zielrelease auswählen, mit **Planen** das tatsächlich für diese Ziele verwendete SQL prüfen und den Release-Namen zur Ausführung eingeben.

Der SQL-Vorschlag unterstützt die vorhandenen Vergleichsoperationen. Er ersetzt keine Prüfung von Datenmigrationen, Abhängigkeiten oder Betriebsanforderungen. Gespeicherte Tabellendefinitionen sind Vergleichsmetadaten, kein vollständiger Datenbank-Dump.

Fetch, Fast-forward-Pull und Push verwenden `origin` und die vorhandene Git-Authentifizierung. Interaktive Passwortabfragen werden nicht geöffnet. Push und Pull verlangen einen sauberen Arbeitsbaum; Force-Push wird nicht angeboten.

## Mehrere Kunden mit unterschiedlichen Versionen

Ein Repository enthält die Releases eines Produkts. Beispielsweise kann Kunde A auf `v1`, Kunde B auf `v2` und Kunde C weiterhin auf `v1` stehen. Beim Zielrelease `v3` plant l8db für A die Schritte `v2 → v3` und für B nur `v3`. Nicht ausgewählte Kunden bleiben auf ihrem bisherigen Stand.

Pro Ziel werden Verbindung, Datenbank, optional abweichendes Schema und Produktionskennzeichnung gespeichert. Die Vorschau zeigt die Schritte und das SQL jedes Ziels. Mehrere ausgewählte Ziele werden nacheinander aktualisiert; beim ersten Fehler endet der Rollout. Bereits erfolgreiche Ziele und Releases behalten ihren neuen Stand.

Unterschiedliche Versionsstände benötigen keine dauerhaften Kundenbranches. Absichtlich unterschiedliche Programmlogik benötigt dagegen ausdrücklich gepflegte Varianten. Ein abweichender Package-Body wird als Drift angezeigt und nicht ungeprüft mit dem Produktstand überschrieben.

Für solche Varianten unterstützt der Dateieditor einen Drei-Wege-Merge: gemeinsamer Basis-Commit, neuer Produkt-Commit und aktueller Kundenentwurf. Konflikte bleiben sichtbar und müssen aufgelöst werden. Das Ergebnis kann als eigener Release mit passender Vorgängerkette gepflegt werden. Ein Kundenrelease darf keine Migrationen aus einer fremden Vorgängerkette überspringen. l8db übernimmt keine automatische fachliche Zusammenführung kundenspezifischer Logik.

## Speicherung und Prüfungen

- `database/project.json`: Projekt und explizit verwaltete Objekte.
- `database/objects/`: lesbare Definitionen; Packages mit separater Specification und Body.
- `database/releases/<id>.json`: vollständiger erwarteter Objektstand, Vorgänger und Migrationen mit SHA-256-Prüfsummen.
- Git-Common-Directory, `l8db-targets.json`: lokale Verbindungszuordnungen und detaillierte Deployment-Ereignisse, gemeinsam für Worktrees. Zugangsdaten werden nicht exportiert.
- Im Zielschema, `L8DB_VERSIONING_STATE`: gemeinsamer Release-Hash, Status und Deployment-Sperre pro Projekt. Die Baseline-Zuordnung legt diese Tabelle an und benötigt entsprechende Rechte.

Ein gespeicherter Zielrelease verweist auf einen konkreten Git-Commit. Bereits commitete Release-Dateien können über die Oberfläche nicht überschrieben werden. Extern manipulierte Manifest-Prüfsummen, veränderte Ausgangsreleases, fehlende Vorgänger und Zyklen werden abgewiesen.

Vor dem Deployment werden Datenbankdefinitionen erneut gelesen und mit der Baseline verglichen. Der freigegebene Plan ist an Commit, Ziel und konkretes SQL gebunden. Eine atomare Datenbank-Sperre verhindert zwei gleichzeitige Deployments desselben Projekts auch aus verschiedenen Repository-Kopien. Dateizugriffe verwenden zusätzlich eine Prozess-übergreifende Sperre und vergleichen beim Speichern den erwarteten vorherigen Inhalt.

## Fehler und Wiederaufnahme

PostgreSQL führt jede Release-Migration in einer eigenen Transaktion aus, einschließlich Aktualisierung des gemeinsamen Release-Stands. Ein SQL-Fehler rollt diesen Release zurück. Zuvor abgeschlossene Releases bleiben angewendet. Nicht transaktionale Operationen wie `CREATE INDEX CONCURRENTLY` werden in diesem Modus abgewiesen.

Oracle führt Anweisungen einzeln aus und stoppt bei Fehlern. DDL kann bereits dauerhaft gespeichert sein. Nach der Ausführung werden verwaltete beziehungsweise neu ungültige Objekte und der erwartete Objektstand geprüft. Package-Specification und Body werden als vollständige Programmeinheiten ausgeführt.

Abbruch, Verbindungsfehler und unvollständige Deployments bleiben als ungeklärt markiert. Es gibt keinen automatischen Retry und keinen vorgetäuschten Oracle-Rollback. Zur Wiederaufnahme tatsächliches Schema und Daten prüfen, gegebenenfalls reparieren, sicherstellen, dass kein Deployment mehr läuft, und über **Stand abgleichen** den passenden Release ausdrücklich bestätigen. Der Schema-Vergleich kann die fachliche Korrektheit bereits ausgeführter Datenänderungen nicht beweisen.

## Umfang

Der verwaltete Umfang ist ausdrücklich die Objektliste des Projekts. Die Schema-Aufnahme übernimmt die vom jeweiligen Adapter angebotenen Vergleichstypen, beispielsweise Tabellen, Views, Routinen, Packages und Sequenzen. Unverwaltete Objekte werden nicht gelöscht. Tabellenvergleiche verwenden Spalten, Constraints, Indizes und Trigger aus dem bestehenden Adapter. Grants, RLS-Policies, alle herstellerspezifischen Speicheroptionen und produktive Daten sind kein vollständiger Bestandteil dieses Snapshots.

Schema-Zuordnung verlangt einen einzelnen Quellschema-Namen je Release. Der Scanner erhält Literale und Kommentare. Nicht sicher abbildbare PostgreSQL-Dollar-Strings werden abgewiesen. Dynamisches SQL muss ausdrücklich für das Ziel geprüft und geschrieben werden.

Es gibt keine automatische Datenzusammenführung, Datenbank-Klonung, Neon-/Supabase-Cloud-Provisionierung oder automatische Down-Migration. Git verwaltet Definitionen und Release-Artefakte; die Ausführung erfolgt bewusst gegen ausgewählte Datenbankziele.

## Tests

```sh
bun test tests/versioning.test.ts
cargo test --manifest-path src-tauri/Cargo.toml versioning::tests --lib
```

Die Live-Tests verwenden echte Git-Repositories, PostgreSQL und Oracle. Eine explizit aktivierte, ignorierte Rust-Testfunktion stellt ausschließlich für das lokale Labor eine HTTP-Brücke bereit. Sie wird nicht in den normalen Anwendungsbetrieb eingebunden. Sie verlangt isolierte Loopback-Datenbanken auf Ports 55440 und 55441 und beschränkt Git-Zugriffe auf das Laborverzeichnis.

Die Datei aus `L8DB_VERSIONING_LAB` ist eine nur für den aktuellen Benutzer lesbare JSON-Datei mit `root`, `repo`, `postgresUrl` und `oracleUrl`. Zugangsdaten gehören weder ins Repository noch in Testausgaben. PostgreSQL verwendet die isolierten Datenbanken `l8db_versioning_dev`, `l8db_versioning_a`, `l8db_versioning_b` und `l8db_versioning_edge`; Oracle verwendet `L8DB_VCS_DEV`, `L8DB_VCS_A` und `L8DB_VCS_B` mit Tablespace-Quota. Die Szenarien setzen ausschließlich diese Testobjekte zurück.

Bei laufendem Vite auf Port 1420 und vorbereiteten Labordatenbanken:

```sh
L8DB_VERSIONING_LAB=/path/to/private-lab.json cargo test --manifest-path src-tauri/Cargo.toml versioning_browser_bridge --lib -- --ignored --nocapture
L8DB_VERSIONING_LAB=/path/to/private-lab.json bun test tests/versioning-live.test.ts tests/versioning-oracle-live.test.ts
```

Abgedeckt sind unter anderem unterschiedliche Kundenstände, veraltete Freigaben, konkurrierende Deployments, direkte Schemaänderungen, Schreibschutz, transaktionaler PostgreSQL-Rollback, Oracle-Teilzustände, Stoppen nach Fehlern, Schema-Zuordnung, getrennte Package-Dateien, konfliktbehaftete und konfliktfreie Drei-Wege-Merges mit großen Quellen, unveränderliche Releases, Worktrees, Remote-Synchronisierung und Dateipfadgrenzen. Die Szenarien lassen sich außerdem über die T3-Browsersteuerung ausführen.

Validierung des Feature-Branches am 20.09.2026: 970 Frontend-Tests und 143 Rust-Tests bestanden; drei Live-Szenarien mit PostgreSQL/Oracle in Chromium beziehungsweise WebKit sowie zwei Produktions-/Sandbox-Browsertests bestanden. TypeScript, Vite-Produktionsbuild, Biome und Clippy liefen ohne Fehler. Bestehende Lint- und Bundle-Warnungen bleiben bestehen. Über T3 wurden zusätzlich Rollout-Vorschau, tatsächliche Ausführung, Drift-Anzeige, manueller Standabgleich und Schutz ungespeicherter Release-Entwürfe geprüft. Die überarbeitete Seitenleiste wurde in Chromium und WebKit mit Badge-Aktualisierung, gegenseitigem Panel-Wechsel, erhaltenen SQL- und Release-Entwürfen, Rollout-Plan beim Wiederöffnen, Tastaturauswahl, dunklem Farbschema, reduzierter Bewegung und schmalem Fenster geprüft. Backend-Tests beziehen sich auf den vorangegangenen Implementierungsstand; die anschließende Überarbeitung verändert ausschließlich Frontend und Dokumentation.

Im abschließenden kombinierten Live-Lauf erreichte WebKit einmal das Zeitlimit von 120 Sekunden. Der anschließende isolierte WebKit-Lauf bestand unverändert in 18 Sekunden; die beiden vorangegangenen Browserläufe waren ebenfalls erfolgreich.
