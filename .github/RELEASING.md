# Releases und Changelog

Der Release-Workflow baut und veröffentlicht die App nach Änderungen auf `main`.
Er ruft die CI einmal als Voraussetzung auf; ein Push nach `main` startet sie nicht
zusätzlich als eigenen Lauf. `cargo clippy --all-targets` prüft dabei auch den
Rust-Code, sodass kein separater `cargo check` nötig ist.
Nach erfolgreichen Builds auf allen Plattformen erzeugt er `CHANGELOG.md` aus
der Git-Historie und erstellt einen Pull Request von `automation/changelog`
nach `main`. Ein bereits offener PR wird beim nächsten Release aktualisiert.
Ohne Änderungen an der Datei wird kein neuer PR erstellt.

Der PR wird regulär geprüft und gemergt; das Ruleset für `main` bleibt aktiv.
Der Workflow pusht keine Commits direkt nach `main`. Der Branch
`automation/changelog` muss für den Token-Inhaber beschreibbar sein, einschließlich
der von der Action verwendeten Force-Pushes beim Aktualisieren eines offenen PRs.

## Einmalige Einrichtung

Als Repository-Secret `RELEASE_PR_TOKEN` einen Fine-grained Personal Access Token
hinterlegen, der auf dieses Repository beschränkt ist und folgende Repository-Rechte hat:

- Contents: Read and write
- Pull requests: Read and write

Der Token-Inhaber benötigt Schreibzugriff auf das Repository. Eine gegebenenfalls
erforderliche Freigabe durch die Organisation muss erfolgt sein.
Der Workflow prüft vor dem Veröffentlichen, ob das Secret vorhanden ist.

Der separate Token sorgt dafür, dass das Erstellen und Aktualisieren des PRs die
regulären `pull_request`-CI-Checks auslöst. Mit dem standardmäßigen `GITHUB_TOKEN`
würden diese Workflows nicht starten; erforderliche Checks könnten dadurch den
Merge blockieren. Siehe die [Dokumentation der PR-Action](https://github.com/peter-evans/create-pull-request#token).

## Verhalten beim Merge

Changelog-Commits enthalten kein `[skip ci]`, sodass die Pflichtchecks normal laufen.
Nur der Release-Workflow ignoriert Pushes, die ausschließlich `CHANGELOG.md`
ändern. Dadurch entsteht keine Schleife aus Release, Changelog-PR und erneutem
Release. Enthält ein Push weitere Änderungen, wird wie bisher veröffentlicht.

Manuelle Releases über `workflow_dispatch` bleiben auf `main` möglich, auch ohne
weitere Dateiänderungen. Auf anderen Branches wird kein Release vorbereitet oder
veröffentlicht.

## Produktionskonfiguration

`bun run production:check` prüft vor jedem Tauri-Releasebuild die Versionsgleichheit,
die CSP samt Hash des Erweiterungs-Startskripts, lokale Fensterberechtigungen und
die Updater-Konfiguration. Die CI testet zusätzlich den gebauten Client mit Monaco
und die Erweiterungsisolation unter Chromium und WebKit.

Die Release-Matrix lädt zunächst alle Plattformartefakte in einen Entwurf hoch.
Erst nach erfolgreichen Checks und Builds sowie der Prüfung von `latest.json`,
Installern und Signaturdateien für beide Mac-Architekturen, Linux und Windows
veröffentlicht der `finalize`-Job den Release. Die wiederverwendete CI verwendet
eine eigene Concurrency-Gruppe, damit sie den aufrufenden Release nicht abbricht. Bei einem Fehler bleibt er als Entwurf
stehen; ein erneuter Lauf kann ihn vervollständigen.

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
`src/lib/extensions/sandbox-frame.js`; Tauri ergänzt die Hashes des gebauten
Dokuments automatisch. `unsafe-eval` bleibt für den
bestehenden CommonJS-Lader im Sandbox-Worker erforderlich. Die Sandbox besitzt
keinen Tauri-Zugriff und blockiert direkte Netzwerkverbindungen durch ihre eigene CSP.
Tauris automatische CSP-Ergänzungen bleiben aktiv.

`freezePrototype` bleibt ausdrücklich deaktiviert: Die verwendeten Signal-Bibliotheken
überschreiben geerbte Methoden wie `valueOf`; eingefrorene Prototypen verhindern den
App-Start. Die Entwicklungs-CSP erlaubt zusätzlich Vite-HMR und dessen Inline-Skripte.

Offene Upstream-Sicherheitsbefunde und Verifikationsgrenzen stehen in
[PRODUCTION.md](PRODUCTION.md).

## Feature-Videos

Nach `finalize` ruft der Release-Workflow `.github/workflows/feature-videos.yml` auf.
Er nimmt neue kuratierte Features aus dem veröffentlichten App-Commit auf und
speichert sie kostenlos als einzelne Pre-Releases im selben Repository. Jeder
Clip wird zuerst als Entwurf mit allen Medien aufgebaut und danach veröffentlicht.
Die bestehende Unveränderlichkeit der App-Releases bleibt aktiv. Der zentrale
Release `feature-videos` enthält ausschließlich den bearbeitbaren JSON-Feed.
Kein Medien-Release wird als neueste App-Version markiert.

Ein täglicher Lauf entfernt abgelaufene Einträge und löscht die zugehörigen
vollständigen Video-Releases nach 48 Stunden. Es werden nur eigens markierte
Video-Releases bereinigt. Der vorhandene `GITHUB_TOKEN` genügt; es sind keine
zusätzlichen Secrets oder Speicherkonten erforderlich.

Aufnahme, manuelle Veröffentlichung, Ablaufregeln und Tests stehen in
[Feature-Videos](../docs/feature-videos-plan.md).
