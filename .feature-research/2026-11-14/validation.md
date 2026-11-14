# Prüfprotokoll · 2026-11-14

## Umfang

Nur drei selbstständige HTML-Konzepte mit synthetischen Daten. Keine Produktdatei, .env, Secret-Datei oder personenbezogene Produktdaten gelesen/verändert. Keine Datenbankverbindung, kein Server, kein Deployment, kein PR. Git-Start synchronisierte `development` unter Koordinationslock; Arbeitsbaum war sauber. Referenzcode: `27fe90e9481e0d344bcf179badbcc07fecf7833f`.

## Darstellung

`html_preview` zeigte alle drei Seiten bei **1440 px und 390 px** vollständig. Nach einem gebündelten Designreview und einem Korrekturdurchgang zusätzlich bei **728 px**, keine Console-Meldungen. Text/Controls sichtbar, keine visuell abgeschnittenen Seitenbereiche; Tabellen haben bei Bedarf einen eigenen Scrollcontainer. Sidebar entfällt unter 1000 px, Form-/Detailbereiche stapeln unter 660 px. Das ist eine responsive Konzeptdarstellung, keine Zusage einer mobilen l8db-App.

| Datei | Erste 1440er Höhe | Erste 390er Höhe | Finale 728er Höhe | Finale Dateigröße |
|---|---:|---:|---:|---:|
| 01-export-beleg.html | 655 px | 1028 px | 643 px | 15.150 B |
| 02-verbindungsdiagnose.html | 793 px | 993 px | 801 px | 14.136 B |
| 03-import-prueflauf.html | 785 px | 1232 px | 773 px | 14.275 B |

Alle drei finalen Seiten wurden mit `html_render` im Thread gezeigt. Keine externe Schrift-/Bild-/Script-Abhängigkeit. Farben werden über CSS-Tokens angesprochen; Default ist dunkel. Fokus-/Hover-/Disabled-Stile vorhanden; Statusmeldungen via `role=status`, Labels und reduzierte Bewegung berücksichtigt. Kein vollständiger Screenreader-/Kontrast-/Tastaturnavigationstest behauptet.

## Interaktion im T3-Preview-Browser

**25 Assertions bestanden**, getrennte Dokumentkontexte, 1280 px Viewport:

- Export, 8: Default „geladen“, Quellenwahl/Limitfeld, ungültiges Limit blockiert, Abbruch ohne verspäteten Erfolg, Erfolgsbeleg, sichtbare Kürzung, Loaded-Export zeigt null Datenbankanfragen, kein Seitenüberlauf.
- Diagnose, 6: fünf Stufen, wählbares Detail, Abbruch ohne Folgeereignisse, gültige Demo-CA führt zu Erfolg, fünf Erfolgsmarkierungen, kein Seitenüberlauf.
- Import, 11: drei Fehlerstellen, Weiter gesperrt, Änderung invalidiert Ergebnis, kein alter Zeilenzähler in leerem Zustand, Abbruch ohne späten Erfolg, korrigierte Datei erfolgreich, Weiter verfügbar, explizite Constraint-Grenze, eigener Trennzeichenfehler, Weiter dadurch blockiert, kein Seitenüberlauf.

Der erste Diagnose-Testversuch scheiterte am Testaufbau: `document.write` in dasselbe globale Window erhielt lexikalische Deklarationen der vorherigen Seite. Nach Navigation auf ein frisches `about:blank` wurde das isolierte Dokument geladen und der zuvor fehlgeschlagene Test erfolgreich ausgeführt. Keine bestandenen Assertions erneut ausgeführt. Standalone-Seiten hatten in `html_preview` keine entsprechenden Console-Fehler.

Download-Buttons erzeugen lokale JSON-Blobs mit simulierten Metadaten; der echte Download-/Dateidialog und Inhalt einer heruntergeladenen Datei wurden nicht automatisiert geprüft. Klick „Import prüfen…“ zeigt den nächsten Konzeptschritt, keine echte Importvorschau oder Datenbankaktion. Die gezählten DB-Anfragen in den Mockups sind erklärende Beispieldaten, keine echten Requestmessungen.

Preview-Tab nach Abschluss geschlossen. Keine fremden Tabs verändert. Ein visueller Review und genau ein Korrekturdurchgang; danach funktionale Prüfung und finale Einbettung, kein weiterer konzeptioneller Review.

## Plattform und Grenzen

Host: **macOS 27.0.1 / Darwin arm64, Apple M3, 16 GiB RAM**. Preview-UA: T3CodeNightly 0.1.10-nightly.20261113.4630, Electron 44.10.1, Chrome 152.0.7977.169. Der UA meldet aus Kompatibilität Intel/Mac OS X 10_15_7; Plattformangabe stammt von Hosttools, nicht UA.

Kein tatsächlicher Datenbankprovider, keine installierte Tauri-App, kein Windows/Linux, keine CPU-/Heap-Simulation, kein nativer RAM-/Latenzbenchmark. Kein gemessener Performancegewinn behauptet. Vorgeschlagene Workloads/Budgets in concepts.md gelten für spätere Produktimplementierung.

Gemäß AGENTS keine TS-/Rust-/Produkt-/Vollsuite nötig oder ausgeführt, da ausschließlich Forschung/Mockups hinzugefügt. HTML-Interaktionen wurden wegen des expliziten Mockup-Prüfauftrags separat getestet.
