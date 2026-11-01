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

Der ungefilterte Bun-Audit meldet weiterhin
[GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
für `deepmerge` 4.3.1 im Shadcn-Entwicklungswerkzeugpfad. Upstream veröffentlicht
bislang keine gepatchte Version. Die vorhandene CI-Ausnahme bleibt ausdrücklich
ein offener Befund; sie bedeutet keinen vollständig sauberen Roh-Audit.

Rust-Builds verwenden `Cargo.lock` mit `--locked`. PostgreSQL-Protokoll und -Treiber,
plist/quick-xml, anyhow, event-listener und chacha20 wurden aktualisiert. SQL Server
verwendet jetzt Tiberius mit `native-tls`, wie PostgreSQL und MySQL den TLS-Stack des
Betriebssystems. Tiberius prüft weiterhin Hostnamen und Zertifikate, außer eine
Verbindung fordert explizit `trust_server_certificate` an.

## Noch offene RustSec-Befunde

Der Rust-Audit ist nicht vollständig grün. Diese Befunde werden nicht global
unterdrückt; `cargo audit` meldet sie weiterhin:

| Befund | Abhängigkeit | Einschränkung |
| --- | --- | --- |
| [RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html) | `rsa` über `russh`/`ssh-key` | Kein veröffentlichter Patch. Ein Entfernen der RSA-Unterstützung würde bestehende SSH-Verbindungen beeinträchtigen. |
| [RUSTSEC-2024-0429](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) | `glib` 0.18 über den Linux-GTK-Unterbau | Die korrigierte Major-Version erfordert eine entsprechende Umstellung im Tauri/GTK-Unterbau. |
| [RUSTSEC-2026-0097](https://rustsec.org/advisories/RUSTSEC-2026-0097.html) | `rand` 0.7 über `winauth` | Windows Integrated Authentication bindet die alte Version transitiv ein. |

Die CI führt `cargo audit` aus und ignoriert dabei ausschließlich RUSTSEC-2023-0071, weil
dafür kein Patch existiert. Die übrigen Einträge sind Warnungen (unsound/unmaintained) und
lassen den Lauf nicht scheitern; jede neue Schwachstelle bricht die CI ab.

Zusätzlich bestehen Wartungshinweise zu `paste`, `proc-macro-error` und den
`unic-*`-Paketen aus transitiven Abhängigkeiten. Neue Upstream-Versionen erneut mit
`cargo audit` prüfen. Diese Liste ist keine pauschale Risikoakzeptanz und kein
vollständiger Sicherheitsnachweis.

Die früheren ZIP-Advisories RUSTSEC-2026-0367/0368/0369 werden nicht mehr ignoriert.
Calamine 0.37, DuckDB/libduckdb-sys 1.20000.1 und tauri-plugin-updater 2.14.1
ersetzen die betroffenen ZIP-Versionen durch ZIP 9. Tokio wurde auf 1.54.1 aktualisiert.
DuckDB 1.20000.1 benötigt den dokumentierten lokalen
[NULL-Konvertierungspatch](../src-tauri/vendor/duckdb/L8DB-PATCH.md), damit Arrow-60-Nullspalten
und verschachtelte NULL-Werte keine Panic und vergiftete Pool-Verbindungen auslösen.
Die RSA-Ausnahme bleibt offen: russh 0.64 und selbst 0.65 verlangen exakt
rsa 0.10.0-rc.18, und RustSec nennt weiterhin keine gepatchte Version.
Diese Ausnahme bedeutet ausdrücklich keinen vollständig grünen unkonfigurierten `cargo audit`.

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
