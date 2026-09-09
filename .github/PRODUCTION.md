# Produktionsstand

Die App wird bewusst ohne Plattformzertifikate verteilt. Signierte Auto-Updates
bleiben aktiv. Einrichtung, Release-Gates und CSP-Ausnahmen stehen in
[RELEASING.md](RELEASING.md).

## Abhängigkeiten

Bun ist die einzige Paketverwaltung. `bun.lock` enthält die geprüfte Auflösung;
CI und Release verwenden Bun 1.3.10 und `--frozen-lockfile`. Die CI führt `bun audit`
aus. Das DOMPurify-Override aktualisiert insbesondere Monacos fest gepinnte alte
Sanitizer-Version innerhalb derselben Major-Version. Der Produktions-Browsertest
prüft den Editor nach diesem Update. Der nicht verwendete Monaco-Vite-Plugin und
das Browserpaket `path` wurden entfernt; Shadcn gehört zu den Entwicklungswerkzeugen.

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

Zusätzlich bestehen Wartungshinweise zu `paste`, `proc-macro-error` und den
`unic-*`-Paketen aus transitiven Abhängigkeiten. Neue Upstream-Versionen erneut mit
`cargo audit` prüfen. Diese Liste ist keine pauschale Risikoakzeptanz und kein
vollständiger Sicherheitsnachweis.

## Grenzen der lokalen Verifikation

Die automatisierten Browsertests prüfen den gebauten Client mit gemocktem Tauri-
Transport sowie die echte Browser-Sandbox. Sie ersetzen keine nativen Windows-
oder Linux-Tests, keine End-to-End-Prüfung jedes Datenbankadapters und keinen
Installations-/Update-Test auf allen Betriebssystemen. Die ignorierten Lab-Tests
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
