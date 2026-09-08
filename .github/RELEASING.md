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
