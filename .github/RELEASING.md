# Releases und Changelog

Der Release-Workflow baut und veröffentlicht die App nach Änderungen auf `main`.
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

### Betrieb ohne Plattformzertifikate

Die Distribution erfolgt bewusst ohne Apple-Developer- oder Windows-Code-Signing-
Zertifikate und ohne Apple-Notarisierung. Betriebssysteme können deshalb beim
Installieren oder ersten Start Warnungen anzeigen. `hardenedRuntime` ersetzt weder
eine Developer-ID-Signatur noch eine Notarisierung. macOS wird ab Version 12 mit aktuellem WebKit (Safari 16.4 oder neuer) unterstützt.
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
`src/lib/extensions/sandbox-frame.js`; dessen SHA-256-Hash muss nach Änderungen in
`app.security.csp.script-src` aktualisiert werden. `unsafe-eval` bleibt für den
bestehenden CommonJS-Lader im Sandbox-Worker erforderlich. Die Sandbox besitzt
keinen Tauri-Zugriff und blockiert direkte Netzwerkverbindungen durch ihre eigene CSP.
Tauris automatische CSP-Ergänzungen bleiben aktiv.

`freezePrototype` bleibt ausdrücklich deaktiviert: Die verwendeten Signal-Bibliotheken
überschreiben geerbte Methoden wie `valueOf`; eingefrorene Prototypen verhindern den
App-Start. Die Entwicklungs-CSP erlaubt zusätzlich Vite-HMR und dessen Inline-Skripte.

Offene Upstream-Sicherheitsbefunde und Verifikationsgrenzen stehen in
[PRODUCTION.md](PRODUCTION.md).
