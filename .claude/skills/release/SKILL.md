---
name: release
description: Neues l8db-Release auslösen: PR development → main öffnen oder aktualisieren, nach Bestätigung mit Merge-Commit mergen und den automatischen Release-Lauf verfolgen.
---

# l8db Release

Ablauf nach semantic-release: Was auf `main` landet, veröffentlicht der Workflow **Release** automatisch. Version und Notes kommen aus den Conventional Commits seit dem letzten Tag (`feat` → Minor, `fix`/`perf` → Patch, `!` → Major, vor 1.0 Minor; ohne solche Commits kein Release). Nichts wird ins Repository zurückcommittet, ein Back-Merge ist nicht nötig. Details: `.github/RELEASING.md`.

Grundregeln:
- Der Arbeitsbaum in `/Users/leon/l8db` kann fremde, nicht committete Änderungen enthalten. Nie dort auschecken, stashen oder resetten; andere Branches nur über temporäre Worktrees unter `/tmp`.
- Den PR nach `main` nur nach ausdrücklicher Bestätigung des Nutzers mergen.
- Commit-Messages ohne `Co-Authored-By` oder sonstige Attribution.
- Den PR mit `link_pull_request` (t3-code MCP) verknüpfen, falls verfügbar.

## Ablauf

1. Stand prüfen:
   ```bash
   git fetch origin --prune --tags
   gh run list --workflow release.yml --branch main --limit 1
   gh pr list --base main --head development --state open --json number,url
   git log --oneline --no-merges origin/main..origin/development
   git log --oneline --no-merges origin/development..origin/main
   ```
   - Läuft noch ein Release, Status melden; ein neuer Merge wartet ohnehin, bis er fertig ist.
   - Keine Commits auf `development` → nichts zu releasen, Ende.
   - Commits nur auf `main` (z. B. Packaging-PR) → zuerst in einem Worktree `origin/main` nach `development` mergen und pushen.
2. Voraussichtliche Version mit derselben Logik wie der Workflow berechnen:
   ```bash
   node --input-type=module -e "
   import { execFileSync } from 'node:child_process';
   import { releaseState } from './.github/scripts/release-plan.mjs';
   import { newestRelease, releases } from './.github/scripts/release-utils.mjs';
   const all = releases();
   const range = newestRelease(all).tag_name + '..origin/development';
   const log = execFileSync('git', ['log', range, '--no-merges', '--format=%B%x00'], { encoding: 'utf8' });
   console.log(releaseState('', all, log.split('\0').map((m) => m.trim()).filter(Boolean)));
   "
   ```
   `mode: skip` heißt: Der Merge würde nichts veröffentlichen. Dann melden und nur auf Wunsch einen PR ohne Versionsangabe im Titel öffnen.
3. Checks in einem temporären Worktree von `origin/development`: `bun install --frozen-lockfile && bun run test && npx tsc -p tsconfig.app.json --noEmit`. Fehler melden und nicht weitermachen.
4. PR öffnen oder den offenen aktualisieren: `gh pr create --base main --head development --title "Release vX.Y.Z: <2–4 Highlights>" --body-file <tmp>` bzw. `gh pr edit`. Body auf Deutsch: voraussichtliche Version und Bump, Abschnitte `## Neue Features`, `## Fehlerbehebungen`, `## Performance`, `## Sicherheit`, `## CI & Tests` (nur mit Inhalt), `## Checks lokal` mit den tatsächlich ausgeführten Checks, Hinweis **mit Merge-Commit mergen**. Neue Commits auf `development` landen automatisch im offenen PR.
5. PR verknüpfen, Link und Version melden, auf Bestätigung warten. Danach `gh pr merge <nr> --merge` und den Lauf nennen: `gh run list --workflow release.yml --branch main --limit 1`.

Fixes für ein laufendes oder fehlgeschlagenes Release: normal auf `development` committen und erneut `/release`. Ein fehlgeschlagener Lauf hinterlässt nur einen Entwurf, der beim nächsten Lauf ersetzt wird.
