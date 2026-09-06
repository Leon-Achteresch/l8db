# UI und PostgreSQL-Verbindungen

Der Verbindungsmanager bietet eine direkte Einrichtung, Suche nach Name/Host/Tag, bearbeitbare Profile und einen expliziten Verbindungsaufbau. PostgreSQL, Supabase, Neon und andere PostgreSQL-Hosts verwenden denselben nativen PostgreSQL-Adapter. Die Anbieterwahl liefert Eingabehilfen; sie ist keine Integration in die Management-APIs der Anbieter.

Die Übersicht zeigt echte Datenbankobjekte, Tabellenzugänge, Schema-Größen und den Abfrageverlauf der ausgewählten Datenbank. Fehler werden als Fehler dargestellt, statt fehlgeschlagene Zählungen als null Objekte auszugeben. Die Oberfläche verwendet Geist, gemeinsame helle/dunkle Farbtokens, eine Statusleiste und Bewegungen unter Berücksichtigung der Systemeinstellung für reduzierte Animationen.

## Verbindungsverhalten

- Speichern aktiviert kein Profil. Öffnen prüft den Zugang zuerst mit einer frischen PostgreSQL-Verbindung.
- Verbindungswechsel werden nacheinander ausgeführt. Eine offene Transaktion muss vor dem Trennen oder Wechseln abgeschlossen werden.
- Verbindungspools unterscheiden Zugangsdaten einschließlich Passwort und Ziel-Datenbank. Metadaten- und Abfragepools werden separat und bei Bedarf erstellt. Leerlaufverbindungen können nach 60 Sekunden abgebaut werden.
- Die SSL-Auswahl ersetzt einen vorhandenen `sslmode`, ohne sonstige URL-Parameter neu zu kodieren. `verify-ca` und `verify-full` werden auch für Transaktionen unterstützt.
- TLS verwendet den System-Zertifikatsspeicher. Bei `verify-ca` wird die Zertifikatskette geprüft, bei `verify-full` zusätzlich der Hostname. `require` behält die strengere Zertifikats- und Hostnamenprüfung des bisherigen nativen Connectors bei. Private Zertifizierungsstellen müssen im System als vertrauenswürdig eingerichtet sein.
- Der SSH-Zielhost und -port kommen bei neuen bzw. bearbeiteten Profilen aus der Datenbank-URL. Bestehende Profile behalten beim Verbinden ihr gespeichertes SSH-Ziel. Der lokale Tunnel wird über `hostaddr` angesprochen, während der ursprüngliche Hostname für TLS erhalten bleibt. Ein fehlender Tunnel führt zum Fehler.
- Passwörter werden vor dem Schreiben in localStorage entfernt. Bei einem Schlüsselbundfehler bleiben neu eingegebene Datenbank- und SSH-Geheimnisse ausschließlich im Speicher der laufenden Sitzung verfügbar.
- Profileditierung trennt einen aktiven Zugang und entfernt seine zwischengespeicherten Abfrageergebnisse. Danach wird explizit neu verbunden.

## Anbieterhinweise

Supabase empfiehlt für Datenbank-GUIs eine direkte Verbindung; bei einem reinen IPv4-Netz ist der Session Pooler eine Alternative. Der Transaction Pooler auf Port 6543 hat Einschränkungen bei vorbereiteten Statements und wird deshalb im Editor eigens gekennzeichnet. Quelle: [Supabase-Verbindungsdokumentation](https://supabase.com/docs/guides/database/connecting-to-postgres).

Neon-URLs können unter anderem `sslmode` und `channel_binding` enthalten. Diese Optionen werden erhalten und an den PostgreSQL-Treiber übergeben. Private Cloud-Zugänge wurden nicht mit externen Zugangsdaten getestet.

## Motion-Herkunft

- `src/components/motion/animated-badge.tsx`: beUI Animated Badge von Saurabh Chauhan.
- `src/components/motion/segmented-control.tsx`: angepasster beUI-Tabs-Ansatz mit gemeinsamer Spring-Auswahlfläche und nativen Radio-Inputs.
- Die aktive Tab- und Sidebar-Markierung verwendet denselben Spring-Ansatz.

Quellen: [beUI Animated Badge](https://beui.dev/components/motion/animated-badge), [beUI Tabs](https://beui.dev/components/motion/tabs), [Repository](https://github.com/starc007/ui-components). Die MIT-Lizenz ist in [beui-LICENSE.txt](./beui-LICENSE.txt) enthalten.

## Prüfung

- `bun run test`: Regressionstests für URLs, SSL, Passwortschutz, SSH und Verbindungswechsel mit gemocktem Tauri-Transport.
- `bun run build`: TypeScript-Prüfung und Produktionsbundle.
- `cargo test --lib`: Rust-Unit-Tests einschließlich SSL, URL-Optionen und Pool-Schlüsseln.
- `cargo test --lib -- --ignored --test-threads=1`: echtes lokales PostgreSQL-/SSH-Labor gemäß AGENTS.md; einschließlich falschem Passwort nach bereits aufgebautem Pool.
- `cargo build` und `cargo clippy --lib`: native Kompilierung und Rust-Lint.

Die automatische visuelle Browserprüfung war in dieser Sitzung nicht verfügbar. Bestehende Clippy-Hinweise zu umfangreichen Command-Signaturen und ungenutzten Methoden sowie die Vite-Warnung zum großen Editor-Bundle bleiben separat zu behandeln.
