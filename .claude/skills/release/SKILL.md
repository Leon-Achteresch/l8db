---
name: release
description: Neues l8db-Release schneiden (release/vX.Y.Z von development, PR nach main), Review-Fixes auf dem Release-Branch einspielen und nach dem Merge abschließen (Back-Merge nach development, Branch löschen, Versions-PR prüfen). Aufruf `/release`, `/release fix`, `/release finish`.
---

# l8db Release

Release-Fluss: `development` → `release/vX.Y.Z` → PR nach `main` (Merge-Commit) → Workflow **Prepare release PR** öffnet `automation/release` (`Release vX.Y.Z`) → dessen Merge veröffentlicht. `development` bleibt währenddessen frei für das nächste Release.

Grundregeln:
- Der Arbeitsbaum in `/Users/leon/l8db` kann fremde, nicht committete Änderungen enthalten. Nie dort auschecken, stashen oder resetten. Git-Operationen auf anderen Branches laufen über temporäre Worktrees unter `/tmp`.
- Nie selbst nach `main` mergen und keinen PR nach `main` mergen, ohne dass der Nutzer es ausdrücklich bestätigt.
- Commit-Messages ohne `Co-Authored-By` oder sonstige Attribution.
- Jeden erstellten oder bearbeiteten PR mit `link_pull_request` (t3-code MCP) verknüpfen, falls das Tool verfügbar ist.

Argument bestimmt den Modus: leer → **Start**, `fix` → **Fix**, `finish` → **Finish**. Ohne Argument zuerst prüfen, ob schon ein offener `release/*`-PR existiert. Wenn ja, nicht neu starten, sondern Status melden und `fix` oder `finish` vorschlagen.

## Start

1. Stand holen und prüfen:
   ```bash
   git fetch origin --prune --tags
   gh pr list --base main --state open --json number,title,headRefName
   git log --oneline --no-merges origin/main..origin/development
   ```
   - Offener PR mit Head `release/*` → abbrechen, siehe oben.
   - Offener PR mit Head `development` → dem Nutzer vorschlagen, ihn zu schließen und durch den Release-Branch zu ersetzen. Erst nach Zustimmung `gh pr close <nr> --comment "Ersetzt durch Release-Branch"`.
   - Keine Commits → melden, dass nichts zu releasen ist, Ende.
   - Offener `automation/release`-PR → melden; das vorherige Release ist noch nicht veröffentlicht.
2. Voraussichtliche Version wie der Release-Workflow berechnen (Conventional Commits seit dem letzten Tag auf `main`):
   ```bash
   prev=$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*.[0-9]*' origin/main)
   node --input-type=module -e "
   import { execFileSync } from 'node:child_process';
   import { nextVersion, semanticBump } from './.github/scripts/release-utils.mjs';
   const base = process.argv[1].slice(1);
   const log = execFileSync('git', ['log', process.argv[1] + '..origin/development', '--no-merges', '--format=%B%x00'], { encoding: 'utf8' });
   const bump = semanticBump(log.split('\0').map((m) => m.trim()), base);
   console.log(nextVersion(base, base, bump), bump);
   " "$prev"
   ```
   Der Workflow bestimmt die endgültige Nummer. Wenn ein Entwurf die Nummer schon belegt, wird es der nächste Patch.
3. Release-Branch ohne Checkout anlegen und pushen:
   ```bash
   git push origin origin/development:refs/heads/release/vX.Y.Z
   ```
4. PR erstellen: `gh pr create --base main --head release/vX.Y.Z --title "Release vX.Y.Z: <2–4 Highlights>" --body-file <tmp>`. Body auf Deutsch im Stil früherer Release-PRs (`gh pr view 163`):
   - Einleitung: bringt `release/vX.Y.Z` (Stand `development` vom <Datum>) nach `main`; voraussichtlich vX.Y.Z (<bump>), die endgültige Version und Release-Notes erzeugt der Workflow; **mit Merge-Commit mergen, nicht squashen**.
   - `## Neue Features`, `## Sicherheit`, `## Fehlerbehebungen`, `## Performance`, `## CI & Tests` – aus `git log origin/main..origin/development --no-merges` zusammengefasst, nach Bereich gruppiert, nur Abschnitte mit Inhalt.
   - `## Checks lokal` nur mit tatsächlich ausgeführten Checks. Vorher mindestens in einem temporären Worktree des Release-Branches `bun install --frozen-lockfile && bun run test && npx tsc -p tsconfig.app.json --noEmit` ausführen; Fehler im PR unter `## Offen` aufführen und dem Nutzer melden.
5. PR verknüpfen, dem Nutzer PR-Link, voraussichtliche Version und den nächsten Schritt nennen: Review und Merge per Merge-Commit, danach `/release finish`.

## Fix

Für Korrekturen am offenen Release (Review-Findings, CI-Fehler). Neue Features gehören nach `development`, nicht hierher.

```bash
git fetch origin
git worktree add /tmp/l8db-release-fix release/vX.Y.Z   # bzw. -B, falls lokal schon vorhanden
```
Im Worktree fixen, Checks laufen lassen, committen (Conventional Commit), `git push origin HEAD:release/vX.Y.Z`. Danach den Fix sofort nach `development` übernehmen, damit nichts verloren geht:
```bash
git -C /tmp/l8db-release-fix fetch origin
git -C /tmp/l8db-release-fix checkout --detach origin/development
git -C /tmp/l8db-release-fix merge --no-ff origin/release/vX.Y.Z -m "Merge branch 'release/vX.Y.Z' into development"
git -C /tmp/l8db-release-fix push origin HEAD:development
git worktree remove /tmp/l8db-release-fix
```
Keine Cherry-Picks. Bei Merge-Konflikten stoppen und den Nutzer fragen.

## Finish

1. `gh pr view release/vX.Y.Z --json state,mergeCommit` muss `MERGED` sein, sonst Status melden und Ende.
2. `main` nach `development` zurückmergen:
   ```bash
   git fetch origin --prune --tags
   git worktree add --detach /tmp/l8db-backmerge origin/development
   git -C /tmp/l8db-backmerge merge --no-ff origin/main -m "Merge remote-tracking branch 'origin/main' into development"
   git -C /tmp/l8db-backmerge push origin HEAD:development
   git worktree remove /tmp/l8db-backmerge
   ```
3. `git push origin --delete release/vX.Y.Z` und `git branch -D release/vX.Y.Z 2>/dev/null`.
4. Versions-PR prüfen: `gh pr list --head automation/release --json number,title,url,statusCheckRollup`. Titel und Version melden und verknüpfen. Nach ausdrücklicher Bestätigung des Nutzers mit Merge-Commit mergen (`gh pr merge <nr> --merge`); erst das veröffentlicht. Erscheint der PR nicht, den Lauf von **Prepare release PR** prüfen: `gh run list --workflow release-prepare.yml --limit 3`.
5. Nach dessen Merge `main` erneut nach `development` zurückmergen (Schritt 2), damit die Versionsdateien und `CHANGELOG.md` auf `development` landen. Danach den **Release**-Lauf nennen: `gh run list --workflow release.yml --limit 1`.
