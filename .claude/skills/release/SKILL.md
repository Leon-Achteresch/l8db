---
name: release
description: Neues stabiles l8db-Release auslösen: PR canary → main öffnen oder aktualisieren, nach Bestätigung mit Merge-Commit mergen und den Release-Lauf verfolgen. Enthält den Hotfix-Ablauf.
---

# l8db Release

Stabile Releases entstehen nur auf `main`: Jeder Push auf `main` veröffentlicht über den Workflow **Release** automatisch `vX.Y.Z` als „Latest“. Version und Notes kommen aus den Conventional Commits seit dem letzten stabilen Tag (`feat` → Minor, `fix`/`perf` → Patch, `!` → Major, vor 1.0 Minor; ohne solche Commits kein Release). Auf `main` kommt nur, was vorher als Canary erschienen ist: Der PR geht immer von `canary` nach `main`. Neue Canaries erzeugt `/canary`. Nichts wird ins Repository zurückcommittet; ein Rück-Merge ist nur nach einem Hotfix nötig. Details: `.github/RELEASING.md`.

Grundregeln:
- Der Arbeitsbaum in `/Users/leon/l8db` kann fremde, nicht committete Änderungen enthalten. Nie dort auschecken, stashen oder resetten; andere Branches nur über temporäre Worktrees unter `/tmp`.
- PRs nach `main` nur nach ausdrücklicher Bestätigung des Nutzers mergen, immer mit Merge-Commit.
- Commit-Messages ohne `Co-Authored-By` oder sonstige Attribution.
- PRs mit `link_pull_request` (t3-code MCP) verknüpfen, falls verfügbar.

## Ablauf

1. Stand prüfen:
   ```bash
   git fetch origin --prune --tags
   gh run list --workflow release.yml --branch canary --limit 1
   gh run list --workflow release.yml --branch main --limit 1
   gh pr list --base main --head canary --state open --json number,url
   git log --oneline --no-merges origin/main..origin/canary
   git log --oneline --no-merges origin/canary..origin/development
   ```
   - Läuft noch ein Canary-Lauf, abwarten oder melden. Läuft ein Release auf `main`, Status melden; ein neuer Merge wartet ohnehin.
   - Keine Commits auf `canary`, die `main` fehlen: nichts zu releasen. Liegen neue Commits auf `development`, zuerst `/canary` vorschlagen.
   - Neue Commits auf `development` gehören nicht in dieses Release. Sollen sie mit, erst `/canary` ausführen und das Canary abwarten.
2. Prüfen, dass genau dieser Stand als Canary erschienen ist:
   ```bash
   GITHUB_REF_NAME=canary node .github/scripts/release-plan.mjs origin/canary
   ```
   - `No release: complete (vX.Y.Z-canary.N)`: dieser Commit ist als Canary veröffentlicht.
   - `No release: skip`: seit dem letzten Canary nur Änderungen ohne Release-Wirkung (Doku, CI, Tests). In Ordnung.
   - `Release v…`: Der Stand ist noch nicht als Canary erschienen, weil der Lauf fehlt, läuft oder fehlgeschlagen ist. Nicht weitermachen, sondern den Canary-Lauf melden.
3. Stabile Version mit derselben Logik wie der Workflow berechnen:
   ```bash
   node --input-type=module -e "
   import { execFileSync } from 'node:child_process';
   import { releaseState } from './.github/scripts/release-plan.mjs';
   import { newestRelease, releases } from './.github/scripts/release-utils.mjs';
   const all = releases();
   const range = newestRelease(all).tag_name + '..origin/canary';
   const log = execFileSync('git', ['log', range, '--no-merges', '--format=%B%x00'], { encoding: 'utf8' });
   console.log(releaseState('', all, log.split('\0').map((m) => m.trim()).filter(Boolean)));
   "
   ```
   `mode: skip` heißt: Der Merge würde nichts veröffentlichen. Dann melden und nur auf Wunsch einen PR ohne Versionsangabe im Titel öffnen.
4. Checks in einem temporären Worktree von `origin/canary`: `bun install --frozen-lockfile && bun run test && npx tsc -p tsconfig.app.json --noEmit`. Fehler melden und nicht weitermachen. Worktree danach entfernen.
5. PR öffnen oder den offenen aktualisieren: `gh pr create --base main --head canary --title "Release vX.Y.Z: <2–4 Highlights>" --body-file <tmp>` bzw. `gh pr edit`. Body auf Deutsch: voraussichtliche Version und Bump, getestetes Canary (`vX.Y.Z-canary.N`), Abschnitte `## Neue Features`, `## Fehlerbehebungen`, `## Performance`, `## Sicherheit`, `## CI & Tests` (nur mit Inhalt), `## Checks lokal` mit den tatsächlich ausgeführten Checks, Hinweis **mit Merge-Commit mergen**. Neue Pushes auf `canary` landen automatisch im offenen PR.
6. PR verknüpfen, Link und Version melden, auf Bestätigung warten. Danach `gh pr merge <nr> --merge` und den Lauf nennen: `gh run list --workflow release.yml --branch main --limit 1`.

Fixes für ein laufendes oder fehlgeschlagenes Release: auf `development` committen, `/canary` ausführen und danach erneut `/release`. Ein fehlgeschlagener Lauf hinterlässt nur einen Entwurf, der beim nächsten Lauf ersetzt wird.

## Hotfix

Für dringende Fehler in der stabilen Version, ohne den Stand von `canary` mitzunehmen:

1. Temporären Worktree mit neuem Branch von `origin/main` anlegen: `git worktree add -b fix/<thema> /tmp/l8db-fix-<thema> origin/main`. Fix als `fix: …` committen, Checks wie in Schritt 4, Branch pushen.
2. PR `fix/<thema>` → `main` öffnen (Body auf Deutsch, Hinweis **mit Merge-Commit mergen**), verknüpfen und auf Bestätigung warten. Nach dem Merge veröffentlicht `main` die Patch-Version.
3. Sofort danach `main` nach `development` holen: Worktree von `origin/development`, `git merge --no-ff origin/main -m "Merge branch 'main' into development"`, Konflikte lösen, pushen. Anschließend `/canary` ausführen.

Schritt 3 ist Pflicht. Bis dahin fehlt der Fix im Canary-Kanal, und der Canary-Lauf bricht mit `… has commits missing on canary` ab, solange `main` Commits enthält, die auf `canary` fehlen. Temporäre Worktrees und den `fix/*`-Branch danach entfernen.
