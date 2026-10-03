# Releases

## Ablauf

Der Ablauf folgt [semantic-release](https://semantic-release.gitbook.io/semantic-release/support/faq): Was auf `main` landet, wird automatisch veröffentlicht. Es gibt keinen Versions-PR, keine Release-Branches und keinen Bot-Commit zurück ins Repository.

1. Gearbeitet wird auf `development`. Ein PR `development` → `main` wird mit Merge-Commit gemergt (Skill `/release`).
2. Jeder Push auf `main` startet **Release**. `prepare` liest die Conventional Commits seit dem letzten veröffentlichten Tag: `feat` erhöht Minor, `fix` und `perf` Patch, `!` oder `BREAKING CHANGE:` Major (vor 1.0 Minor). Ohne solche Commits (nur `docs`, `ci`, `chore`, …) wird nichts veröffentlicht. Ist der Commit bereits veröffentlicht, wird alles übersprungen.
3. Die CI und drei unsignierte Produktionskompilierungen laufen parallel. Kompilierungsjobs haben Leserechte und erhalten keine Signierschlüssel. Rust ist auf `1.99.0` in `.github/actions/setup-rust/action.yml`, Bun auf `1.3.10` und Node auf `24.14.0` festgelegt. CI, PR-Builds und Produktionsbuilds haben eigene Cache-Namespaces; Zielarchitekturen fließen in die Schlüssel ein. GitHub Actions sind auf Commit-SHAs festgelegt und bleiben über Dependabot aktualisierbar.
4. Nach erfolgreichen Prüfungen und Kompilierungen wird ein Release-Entwurf für den konkreten Commit angelegt. Separate Jobs prüfen die übertragenen Binärdateien und paketieren sie mit `tauri bundle`, ohne erneut zu kompilieren. Nur diese Jobs erhalten die jeweiligen Signierzugänge. macOS behält Developer ID, Hardened Runtime, Notarisierung und Gatekeeper-Prüfung.
5. Auf jedem Betriebssystem laufen native Installations- und Upgrade-Prüfungen. Die vorherige stabile Version und die neue Version werden gestartet; die native CLI muss funktionieren und die GUI darf beim Start nicht abstürzen. Windows prüft NSIS-Upgrade und MSI-Inhalt, Linux AppImage-Ersetzung und Debian-Inhalt, macOS DMG-Installation und App-Ersetzung. Die enthaltenen Programme müssen dem gebauten beziehungsweise signierten Programm entsprechen. Tests laufen ausschließlich auf isolierten GitHub-Runnern.
6. `finalize` lädt alle Artefakte herunter, prüft Größen, SHA-256, Paketformate, Plattformzuordnung und Updater-Signaturen gegen den eingecheckten öffentlichen Schlüssel. Die Signaturen im Manifest müssen exakt den geprüften `.sig`-Dateien entsprechen. Erst danach werden `latest.json`, `SHA256SUMS` und `release-metadata.json` hochgeladen und der Release veröffentlicht. Ein älterer Release darf `latest` nicht ersetzen.
7. **Release follow-up** wird unabhängig über `workflow_run` gestartet. Er erstellt einen Packaging-PR und startet die Feature-Videos. Fehler in diesen Jobs ändern den Status der App-Veröffentlichung nicht.

## Version und Changelog

Die Versionen in `package.json`, `Cargo.toml`, `Cargo.lock` und `tauri.conf.json` sowie `CHANGELOG.md` im Repository sind nicht maßgeblich und werden nicht mehr gepflegt. Jeder Release-Job setzt die berechnete Version mit `.github/scripts/set-version.mjs` nur im Runner und erzeugt `CHANGELOG.md` aus den Tags neu; die App liefert diesen Stand aus, die Release-Notes stammen aus demselben Abschnitt. Maßgeblich sind die Git-Tags und GitHub-Releases. Eine Version lässt sich nur über die Commit-Typen steuern, etwa `feat!:` für den nächsten großen Sprung.

## Wiederholungen und Fehler

- Fehlgeschlagene Jobs desselben Laufs wiederholen. Erfolgreiche Kompilierungsartefakte bleiben sieben Tage verfügbar; wiederholte Kompilierungen ersetzen nur ihren eigenen Snapshot.
- Ein Entwurf wird nur wiederverwendet, wenn Version und vollständiger Quellcommit übereinstimmen. Ein Entwurf derselben Version von einem älteren Commit (fehlgeschlagener Lauf, danach ein Fix auf `main`) wird gelöscht und neu angelegt; Entwürfe haben noch keinen Tag. Läufe auf `main` warten aufeinander, sodass die Version immer auf dem zuletzt veröffentlichten Tag aufsetzt.
- Ist genau dieser Commit schon veröffentlicht, überspringt der Release-Workflow sämtliche Builds und Schreibzugriffe. Die Unveränderlichkeit veröffentlichter Releases bleibt aktiv.
- Packaging oder Videos über **Release follow-up** mit `release_tag` erneut starten. Packaging wird nur für die höchste veröffentlichte stabile Version aktualisiert; ein alter Wiederholungslauf darf keinen aktuellen Paket-PR zurücksetzen.
- Nach Ablauf der Kompilierungsartefakte den gesamten unveröffentlichten Lauf wiederholen. Bereits veröffentlichte Releases brauchen keinen erneuten Build.

Die Job-Tabelle in der Release-Zusammenfassung zeigt Laufzeiten und Ergebnisse. Laufzeitverbesserungen anhand mehrerer warmer Läufe vergleichen; Runner-Wartezeiten, Paket-Mirrors und Apple-Verarbeitung bleiben variable Größen.

## Einmalige Einrichtung

`RELEASE_PR_TOKEN` bleibt ein auf dieses Repository beschränkter Fine-grained Personal Access Token mit **Contents: Read and write** und **Pull requests: Read and write**. Er wird nur noch für den Packaging-PR (`automation/packaging`) verwendet, damit dessen `pull_request`-Checks starten. Die eigentlichen Releases benötigen ihn nicht. Rulesets, Reviews und Pflichtchecks für `main` bleiben aktiv.

Für Signierung und Notarisierung gelten weiterhin die unten beschriebenen Secrets. Es gibt keinen unsignierten Produktions-Fallback.

## Lokal prüfen

```sh
bun run production:check
bun run test:release
actionlint
```

`actionlint` benötigt für die vollständige Shell-Prüfung zusätzlich ShellCheck. CI prüft die Workflow-Struktur mit actionlint `1.7.12`; die Regressionstests prüfen Job-Abhängigkeiten, Rechte, Secret-Trennung, Versionen, Wiederholungen, Signaturen und atomare Packaging-Vorbereitung. Native Installationsprüfungen benötigen die tatsächlichen signierten Installer und laufen erst in der Release-Matrix. Sie prüfen Installation, Ersetzung und Start; sie ersetzen keine vollständige Bedienprüfung oder einen automatisierten Durchlauf der gesamten Updater-Oberfläche.

### Lokale macOS-Signierung und Notarisierung

Das Developer-ID-Application-Zertifikat für Team `R4LQCWA594` ist auf dem
Entwicklungs-Mac im Login-Schlüsselbund installiert und bis 17. September 2031
gültig. Der private Schlüssel gehört nicht ins Repository.

```sh
bun run build:macos:signed
```

Dieser Befehl erstellt eine Developer-ID-signierte App und DMG für die Architektur
des Macs. Er verwendet `src-tauri/tauri.signing.conf.json`; Updater-Artefakte sind
für diesen lokalen Build deaktiviert. Der Befehl allein notarisiert nicht.
Der CI-Release benötigt zusätzlich den separaten Updater-Signierschlüssel.

Für die Notarisierung einmalig ein anwendungsspezifisches Passwort im Apple-Account
erstellen und mit `xcrun notarytool store-credentials l8db --apple-id <Apple-ID>
--team-id R4LQCWA594` interaktiv im Schlüsselbund speichern. Das Passwort wird
verdeckt abgefragt und darf nicht in Konfigurationen oder Shell-Befehlen stehen.

Anschließend die erzeugte DMG einreichen und den Status `Accepted` abwarten:

```sh
xcrun notarytool submit src-tauri/target/release/bundle/dmg/l8db_0.6.0_aarch64.dmg --keychain-profile l8db --wait
xcrun stapler staple src-tauri/target/release/bundle/dmg/l8db_0.6.0_aarch64.dmg
xcrun stapler staple src-tauri/target/release/bundle/macos/l8db.app
xcrun stapler validate src-tauri/target/release/bundle/dmg/l8db_0.6.0_aarch64.dmg
codesign --verify --deep --strict --verbose=2 src-tauri/target/release/bundle/macos/l8db.app
spctl --assess --type execute --verbose=2 src-tauri/target/release/bundle/macos/l8db.app
```

DMG-Dateinamen an Version und Architektur anpassen. Bei längerer Apple-Verarbeitung
kann der Status mit `xcrun notarytool info <Submission-ID> --keychain-profile l8db`
abgefragt werden. Erst nach erfolgreicher Notarisierung und Prüfung verteilen.

`profile.release.build-override.strip = false` verhindert einen Rust/LLVM-Fehler
beim Laden gestrippter Build-Makros unter macOS 27. Die fertige App verwendet
weiterhin das bestehende Release-Profil mit `strip = true`.

### Signierte macOS-Produktionsreleases

Die Release-Pipeline verlangt folgende GitHub-Repository-Secrets:

| Secret | Inhalt |
| --- | --- |
| `APPLE_CERTIFICATE` | Base64-kodiertes PKCS#12 mit Developer-ID-Zertifikat und privatem Schlüssel |
| `APPLE_CERTIFICATE_PASSWORD` | Passwort des PKCS#12-Exports |
| `APPLE_ID` | Apple-Account für die Notarisierung |
| `APPLE_PASSWORD` | Anwendungsspezifisches Apple-Passwort, niemals das Account-Passwort |

Das anwendungsspezifische Passwort erstellt der Account-Inhaber und speichert es
als `APPLE_PASSWORD`, beispielsweise interaktiv mit
`gh secret set APPLE_PASSWORD --repo Leon-Achteresch/l8db`.

Der `prepare`-Job bricht bei fehlenden Secrets ab. Nur der macOS-Matrixjob erhält
die Apple-Zugänge, importiert das Zertifikat in einen temporären Schlüsselbund
und baut mit Developer ID und Notarisierung. Tauri wartet auf Apple und heftet das
Notarisierungsticket an die App. Anschließend werden Zertifikatsidentität,
Team-ID, Hardened Runtime, Ticket und Gatekeeper geprüft. Schlägt eine Prüfung
fehl, bleibt der Release ein Entwurf. Der temporäre Schlüsselbund wird auch nach
Fehlern entfernt. Es gibt keinen unsignierten Fallback.

Windows bleibt ohne Plattformzertifikat; Windows kann deshalb beim Installieren
oder ersten Start warnen. macOS wird ab Version 12 mit aktuellem WebKit
(Safari 16.4 oder neuer) unterstützt.
Der Windows-Installer fordert mindestens WebView2 111 an. Diese Laufzeitgrenzen
folgen den Anforderungen von [Tailwind CSS 4](https://tailwindcss.com/docs/compatibility)
und [Vite 8](https://v8.vite.dev/config/build-options).

Auto-Updates bleiben unabhängig davon signiert. Das Repository-Secret
`TAURI_SIGNING_PRIVATE_KEY` muss zum vorhandenen öffentlichen Updater-Schlüssel passen;
bei einem verschlüsselten Schlüssel zusätzlich `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`
setzen. Der Workflow prüft auf einen vorhandenen Schlüssel, bevor die Builds beginnen.
Private Schlüssel gehören ausschließlich in den Secret-Speicher.

Für einen lokalen macOS-Build ohne Update-Signierschlüssel:

```sh
bun run tauri build --bundles app --config '{"bundle":{"createUpdaterArtifacts":false}}' -- --locked
```

Dieser Override gilt nur für den lokalen Build. Die eingecheckte Release-Konfiguration
fordert weiterhin signierte Update-Artefakte.

### CSP-Kompatibilität

Die Produktions-CSP blockiert externe Skripte, nicht freigegebene Inline-Skripte,
Plugins, Basis-URL-Änderungen und Formularübertragungen. Styles benötigen Inline-
Freigaben für React, Monaco und dynamische Layouts. HTTP(S)-Verbindungen bleiben für
die vom Nutzer freigegebenen Netzwerkfähigkeiten von Erweiterungen verfügbar.
Die Erweiterungsverwaltung beschränkt diese zusätzlich auf freigegebene Hosts.

Das isolierte Erweiterungs-Startskript liegt in
`src/lib/extensions/sandbox-frame.js`. Sein SHA-256-Hash steht ausdrücklich in der
Produktions-CSP, da das Skript erst zur Laufzeit als `srcdoc` eingebettet wird.
`production:check` prüft den Hash gegen die aktuelle Datei; nach Änderungen am
Skript muss der Hash in `src-tauri/tauri.conf.json` angepasst werden. Tauri ergänzt
die Hashes der gebauten Assets automatisch. Die Erweiterungs-Browsertests verwenden
die Produktions-CSP unverändert. `unsafe-eval` bleibt für den
bestehenden CommonJS-Lader im Sandbox-Worker erforderlich. Die Sandbox besitzt
keinen Tauri-Zugriff und blockiert direkte Netzwerkverbindungen durch ihre eigene CSP.
Tauris automatische CSP-Ergänzungen bleiben aktiv.

`freezePrototype` bleibt ausdrücklich deaktiviert: Die verwendeten Signal-Bibliotheken
überschreiben geerbte Methoden wie `valueOf`; eingefrorene Prototypen verhindern den
App-Start. Die Entwicklungs-CSP erlaubt zusätzlich Vite-HMR und dessen Inline-Skripte.

Offene Upstream-Sicherheitsbefunde und Verifikationsgrenzen stehen in
[PRODUCTION.md](PRODUCTION.md).

## Packaging und Feature-Videos

Der Packaging-PR aktualisiert Homebrew, winget, AUR und die Flatpak-Vorlage anhand der veröffentlichten Artefakt-Hashes, des LICENSE-Hashes und des aus dem tatsächlichen MSI gelesenen ProductCode. Fehlende Dateien, Hashes, URLs oder Vorlagenfelder brechen ab, bevor irgendeine Vorlage geschrieben wird. Externe Paket-Repositories werden nicht direkt beschrieben. Details stehen in [packaging/README.md](../packaging/README.md).

Feature-Videos werden nach dem App-Release im unabhängigen Folge-Workflow aufgenommen und als eigene Pre-Releases gespeichert. Der tägliche Ablauf entfernt die dafür markierten Medien nach 48 Stunden. App-Releases und ihre Unveränderlichkeit bleiben erhalten; kein Medien-Release wird als neueste App-Version markiert. Ein fehlgeschlagener Medienlauf lässt sich separat wiederholen. Details stehen in [Feature-Videos](../docs/feature-videos-plan.md).
