# Produktionsstand

Die Release-Konfiguration verlangt für macOS Developer-ID-Signierung und
Apple-Notarisierung; fehlende Apple-Secrets blockieren die Veröffentlichung.
Windows-Releases verlangen jetzt ein Authenticode-Zertifikat und einen gültigen Zeitstempel; fehlende Windows-Secrets blockieren die Veröffentlichung. Lokale Developer-ID-Builds und die
Einrichtung der Produktions-Secrets sind in [RELEASING.md](RELEASING.md)
beschrieben. Signierte Auto-Updates
bleiben aktiv. Einrichtung, Release-Gates und CSP-Ausnahmen stehen in
[RELEASING.md](RELEASING.md).

## Abhängigkeiten

Bun ist die einzige Paketverwaltung. `bun.lock` enthält die geprüfte Auflösung;
CI und Release verwenden Bun 1.3.10 und `--frozen-lockfile`. Produktions-Rust ist in `.github/actions/setup-rust/action.yml` auf 1.99.0 festgelegt; die Pipeline nutzt explizite Runner und Action-Commit-SHAs. Die CI führt `bun audit`
aus. Das DOMPurify-Override aktualisiert insbesondere Monacos fest gepinnte alte
Sanitizer-Version innerhalb derselben Major-Version. Der Produktions-Browsertest
prüft den Editor nach diesem Update. Der nicht verwendete Monaco-Vite-Plugin und
das Browserpaket `path` wurden entfernt; Shadcn gehört zu den Entwicklungswerkzeugen.
Das `minimatch`-Override auf 11.0.1 oder neuer schließt
[GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249)
im transitiven Shadcn/ts-morph-Werkzeugpfad. Es wird mit dem Shadcn-CLI und
einem ts-morph-Dateimuster-Smoke geprüft.

Der Deepmerge-Befund
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
ist durch den lokalen MIT-Fork [@l8db/secure-deepmerge](../packages/secure-deepmerge/README.md)
behoben. Die Override-Auflösung wird für Shadcn und seine Registry geprüft; die Tests
reproduzieren Prototype Poisoning auch mit Null-Prototypen, Zielobjekten und Arrays.
`bun audit` läuft ohne Advisory-Ausnahmen.

Rust-Builds verwenden `Cargo.lock` mit `--locked`. PostgreSQL-Protokoll und -Treiber,
plist/quick-xml, anyhow, event-listener und chacha20 wurden aktualisiert. SQL Server
verwendet jetzt Tiberius mit `native-tls`, wie PostgreSQL und MySQL den TLS-Stack des
Betriebssystems. Tiberius prüft weiterhin Hostnamen und Zertifikate, außer eine
Verbindung fordert explizit `trust_server_certificate` an.

## RustSec und native Kryptografie

`cargo audit` läuft ohne Advisory-Ausnahmen und ohne bekannte Vulnerabilities.
[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html) ist durch
den vollständigen Ersatz von RustCrypto RSA behoben. Cloud-JWTs und die dokumentierten
[Russh-/SSH-Key-Anpassungen](../src-tauri/vendor/ssh-key/L8DB-PATCH.md) verwenden
statisch eingebautes OpenSSL 4.0.3; RSA-Authentifizierung, Hostschlüsselprüfung,
PKCS#1/PKCS#8 und verschlüsselte Schlüssel bleiben verfügbar. Die Schlüsseloperationen
laufen über OpenSSL EVP mit PKCS#1-Padding. SSH-Komponentenumwandlungen nutzen native
BN-Operationen mit Constant-Time-Flags und sicherem BN-Kontext. Der kleine
[openssl-sys-Manifestpatch](../src-tauri/vendor/openssl-sys/L8DB-PATCH.md) wählt die
aktuelle 4.0.3-Quellfassung aus crates.io, weil der standardmäßig verwendete
300.x-Quellzweig weiterhin bei der überholten 3.6.3-Fassung steht. Die Bindings
unterstützen OpenSSL 4 bereits; kryptografischer C-Code wird nicht lokal verändert.

Die CI bricht bei jeder von RustSec als Vulnerability eingestuften Meldung ab.
Die ungefilterte Prüfung enthält weiterhin zwölf Hinweise: Unsoundness in `glib` 0.18
(Linux-GTK) und `rand` 0.7 (Windows-Authentifizierung), ungewartete `paste`,
`proc-macro-error`, `zbus_names` und `zvariant` sowie Yanked-Versionen von
`clipboard-win` und `crypto-bigint`. Diese Hinweise sind sichtbar und werden nicht
unterdrückt; ein erfolgreicher Audit ersetzt keine Prüfung dieser Plattformpfade.

Die früheren ZIP-Advisories RUSTSEC-2026-0367/0368/0369 werden nicht mehr ignoriert.
Calamine 0.37, DuckDB/libduckdb-sys 1.20000.1 und tauri-plugin-updater 2.14.1
ersetzen die betroffenen ZIP-Versionen durch ZIP 9. Tokio wurde auf 1.54.1 aktualisiert.
DuckDB 1.20000.1 benötigt den dokumentierten lokalen
[NULL-Konvertierungspatch](../src-tauri/vendor/duckdb/L8DB-PATCH.md), damit Arrow-60-Nullspalten
und verschachtelte NULL-Werte keine Panic und vergiftete Pool-Verbindungen auslösen.

Maschinenrichtlinie, Team-Einweisung und Abnahmematrix: [Unternehmensrollout](../docs/enterprise-rollout.md).

## Grenzen der lokalen Verifikation

Die automatisierten Browsertests prüfen den gebauten Client mit gemocktem Tauri-
Transport sowie die echte Browser-Sandbox. Der Release-Prozess ergänzt native
Installations- und Upgrade-Smokes auf macOS, Windows und Linux sowie die
kryptografische Prüfung sämtlicher Updater-Pakete. Die Smokes prüfen CLI,
GUI-Start, Paketinhalt und Ersetzung der vorherigen Installation; sie ersetzen
keine vollständige Bedienprüfung, keinen Durchlauf der Updater-Oberfläche und
keine End-to-End-Prüfung jedes Datenbankadapters. Die ignorierten Lab-Tests
benötigen die in `AGENTS.md` beschriebenen Datenbank- und SSH-Instanzen.

## Audit-Nachprüfung am 1. November 2026

- macOS 27.0.1 arm64, Apple M3, 16 GiB RAM, Bun 1.3.10, Rust 1.99.0.
- Ungefilterte `bun audit` und `cargo audit`: Exitcode 0, keine Advisory-Ausnahmen.
  Die zwölf oben beschriebenen RustSec-Hinweise bleiben sichtbar.
- Produktionsbuild, Produktionskonfiguration, Workflow-Validierung, Rustfmt,
  Cargo Check und Clippy mit/ohne Standardfunktionen erfolgreich. Vorhandene
  Lint- und macOS-Debug-Linker-Warnungen werden nicht unterdrückt.
- Deepmerge-/Shadcn-CLI-Tests, Extension-SDK-Test, Release-Workflow-/Signiertests
  und Lizenzaufteilung erfolgreich. Generierte Hinweise enthalten OpenSSL 4.0.3.
- Warehouse-Authentifizierung: 12 Tests bestanden, isolierter RSA-Testlauf: vier
  bestanden einschließlich Performance. BigQuery: neun bestanden, externer
  Emulator-Test ignoriert; Snowflake: sechs bestanden.
- 24 echte PostgreSQL-/SSH-Labtests und 40 CLI-End-to-End-Tests bestanden. SSH nutzt
  ausschließlich RSA-Hostschlüssel; plain/encrypted OpenSSH und PKCS#1 mit 3072-Bit-
  RSA-Clientschlüsseln, falsche Passphrase und Tunnel-Abbau wurden geprüft.
- Native Signatur-/Importbudgets und große Konfigurationsmerges bestanden; Messwerte
  und Grenzen stehen in [performance.md](../docs/performance.md).
- Das macOS-Binary hat keine dynamische OpenSSL-/unixODBC-Abhängigkeit. Die Labs
  und temporären SSH-Agenten wurden nach dem Lauf entfernt.

Die Upstream-Einzeltests waren aus dem App-Workspace mit `cargo test -p` nicht
ausführbar, weil die Crates keine Workspace-Mitglieder sind. Die vendorten Fassungen
enthalten nur die Laufzeitpakete; Upstream-Test-/Beispieldaten mit privaten
Beispielschlüsseln werden nicht mitverteilt und deren Testziele sind deaktiviert. Die RSA-Pfade werden durch die
oben genannten App-Regressionen, unabhängige Ring-Verifikation und OpenSSH-Labtests
geprüft. Windows-/Linux-Desktopbuilds und weitere Datenbankfamilien wurden bei dieser
Nachprüfung nicht lokal ausgeführt. Es wurde kein Release veröffentlicht.

## Verifikation am 9. September 2026

- macOS-arm64-Releasebuild erfolgreich; App-Bundle, ausführbare Datei, Bundle-ID,
  Version und minimale macOS-Version geprüft. Update-Artefakte wurden ausschließlich
  für diesen lokalen Build per CLI-Override deaktiviert.
- 737 Frontend-Tests bestanden, 16 optionale Tests übersprungen.
- 76 Rust-Tests bestanden, 24 Lab-Tests ignoriert.
- Produktionsclient mit Monaco-Worker und Erweiterungsisolation in Chromium und
  WebKit erfolgreich geprüft.
- TypeScript für App und Vite-Konfiguration, Biome, Rustfmt, Cargo Check und Clippy
  ohne Fehler; bestehende Lint- und Dead-Code-Warnungen bleiben sichtbar.
- Bun-Audit ohne bekannte Schwachstellen; RustSec-Restbefunde siehe oben.
- Workflow-YAML und Release-Versions-/Artefaktprüfungen erfolgreich geprüft.
