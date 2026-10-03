# Releases

## Ablauf

1. Änderungen auf `main` starten **Prepare release PR**. Der Workflow erstellt oder aktualisiert `automation/release`. Der PR enthält die nächste Version in `package.json`, `Cargo.toml`, `Cargo.lock` und `tauri.conf.json`, die vollständige `CHANGELOG.md` und `.github/release-plan.json`. Er durchläuft die normalen Reviews und Pflichtchecks. Es gibt keine direkten Bot-Pushes nach `main`.
2. Erst der Merge eines gültigen Release-Plans startet die Veröffentlichung. Der Plan enthält den ursprünglichen Quellcommit und den Hash des Changelogs. Weitere Code- oder Abhängigkeitsänderungen machen den Plan ungültig und erfordern einen aktualisierten Release-PR.
3. Die CI und drei unsignierte Produktionskompilierungen laufen parallel. Kompilierungsjobs haben Leserechte und erhalten keine Signierschlüssel. Rust ist auf `1.99.0` in `.github/actions/setup-rust/action.yml`, Bun auf `1.3.10` und Node auf `24.14.0` festgelegt. CI, PR-Builds und Produktionsbuilds haben eigene Cache-Namespaces; Zielarchitekturen fließen in die Schlüssel ein. GitHub Actions sind auf Commit-SHAs festgelegt und bleiben über Dependabot aktualisierbar.
4. Nach erfolgreichen Prüfungen und Kompilierungen wird ein Release-Entwurf für den konkreten Commit angelegt. Separate Jobs prüfen die übertragenen Binärdateien und paketieren sie mit `tauri bundle`, ohne erneut zu kompilieren. Nur diese Jobs erhalten die jeweiligen Signierzugänge. macOS behält Developer ID, Hardened Runtime, Notarisierung und Gatekeeper-Prüfung.
5. Auf jedem Betriebssystem laufen native Installations- und Upgrade-Prüfungen. Die vorherige stabile Version und die neue Version werden gestartet; die native CLI muss funktionieren und die GUI darf beim Start nicht abstürzen. Windows prüft NSIS-Upgrade und MSI-Inhalt, Linux AppImage-Ersetzung und Debian-Inhalt, macOS DMG-Installation und App-Ersetzung. Die enthaltenen Programme müssen dem gebauten beziehungsweise signierten Programm entsprechen. Tests laufen ausschließlich auf isolierten GitHub-Runnern.
6. `finalize` lädt alle Artefakte herunter, prüft Größen, SHA-256, Paketformate, Plattformzuordnung und Updater-Signaturen gegen den eingecheckten öffentlichen Schlüssel. Die Signaturen im Manifest müssen exakt den geprüften `.sig`-Dateien entsprechen. Erst danach werden `latest.json`, `SHA256SUMS` und `release-metadata.json` hochgeladen und der Release veröffentlicht. Ein älterer Release darf `latest` nicht ersetzen.
7. **Release follow-up** wird unabhängig über `workflow_run` gestartet. Er erstellt einen Packaging-PR und startet die Feature-Videos. Fehler in diesen Jobs ändern den Status der App-Veröffentlichung nicht.

Die vorherigen Commit-Zählerversionen werden automatisch übernommen: Aus Quellversion `0.8.0` und veröffentlichtem `v0.8.24` entsteht `0.8.25`. Bereits reservierte Entwürfe zählen ebenfalls zur Versionsuntergrenze. Die Quellversion am neuen Release-Tag entspricht künftig der ausgelieferten Version.

## Release vorbereiten

Die Version folgt Semantic Versioning und wird aus den Conventional Commits seit dem letzten veröffentlichten Tag abgeleitet: `feat` erhöht Minor, alles andere Patch, `!` oder `BREAKING CHANGE:` erhöht Major (vor 1.0 Minor). Für eine abweichende oder explizite stabile Version **Prepare release PR** manuell auf `main` starten und `bump` beziehungsweise `version` setzen. Versionsnummern müssen alle veröffentlichten und reservierten Versionen übersteigen. Der Workflow erzeugt den prüfbaren PR; er merged ihn nicht selbst.

Der Changelog wird vor dem Build erzeugt und unverändert mitgeliefert. Er berücksichtigt nur stabile, vom Quellcommit erreichbare App-Tags. Feature-Videos, fremde Branch-Tags und der bereits vorhandene Kandidatentag werden nicht als Versionsgrenzen verwendet. Keine manuelle Nachpflege nach der Veröffentlichung nötig.

## Wiederholungen und Fehler

- Fehlgeschlagene Jobs desselben Laufs wiederholen. Erfolgreiche Kompilierungsartefakte bleiben sieben Tage verfügbar; wiederholte Kompilierungen ersetzen nur ihren eigenen Snapshot.
- Ein Entwurf wird nur wiederverwendet, wenn Version und vollständiger Quellcommit übereinstimmen. Codeänderungen nach einem fehlgeschlagenen Release bekommen einen neuen Release-PR und eine neue Version. Alte Entwürfe bleiben für Diagnose und manuelle Bereinigung erhalten.
- Ist genau dieser Commit schon veröffentlicht, überspringt der Release-Workflow sämtliche Builds und Schreibzugriffe. Die Unveränderlichkeit veröffentlichter Releases bleibt aktiv.
- Packaging oder Videos über **Release follow-up** mit `release_tag` erneut starten. Packaging wird nur für die höchste veröffentlichte stabile Version aktualisiert; ein alter Wiederholungslauf darf keinen aktuellen Paket-PR zurücksetzen.
- Nach Ablauf der Kompilierungsartefakte den gesamten unveröffentlichten Lauf wiederholen. Bereits veröffentlichte Releases brauchen keinen erneuten Build.

Die Job-Tabelle in der Release-Zusammenfassung zeigt Laufzeiten und Ergebnisse. Laufzeitverbesserungen anhand mehrerer warmer Läufe vergleichen; Runner-Wartezeiten, Paket-Mirrors und Apple-Verarbeitung bleiben variable Größen.

## Einmalige Einrichtung

`RELEASE_PR_TOKEN` bleibt ein auf dieses Repository beschränkter Fine-grained Personal Access Token mit **Contents: Read and write** und **Pull requests: Read and write**. Der Inhaber benötigt Schreibzugriff auf `automation/release` und `automation/packaging`, einschließlich der Force-Pushes beim Aktualisieren offener PRs. Ein erforderliches Organisations-Approval muss erfolgt sein.

Der Token wird ausschließlich für die Automations-PRs verwendet, damit deren `pull_request`-Checks starten. Ein `GITHUB_TOKEN`-PR würde diese Checks nicht auslösen. Die eigentlichen Releases benötigen den PR-Token nicht. Rulesets, Reviews und Pflichtchecks für `main` bleiben aktiv.

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
