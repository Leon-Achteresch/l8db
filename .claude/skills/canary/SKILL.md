---
name: canary
description: Neue l8db-Canary-Version auslösen: canary per Fast-Forward auf development setzen, nach Bestätigung pushen und den Canary-Lauf verfolgen.
---

# l8db Canary

Jeder Push auf `canary` veröffentlicht über den Workflow **Release** ein GitHub-Pre-Release `vX.Y.Z-canary.N`. `X.Y.Z` ist die nächste stabile Version aus den Conventional Commits seit dem letzten stabilen Tag, `N` zählt je Zielversion hoch und beginnt bei einer neuen Zielversion wieder bei 1. Ohne `feat`/`fix`/`perf` seit dem letzten Canary wird nichts veröffentlicht. Canaries werden nie als „Latest“ markiert; nur Nutzer mit Update-Kanal Canary bekommen sie. Stabile Releases kommen danach mit `/release` aus `canary`. Details: `.github/RELEASING.md`.

Grundregeln:
- Der Arbeitsbaum in `/Users/leon/l8db` kann fremde, nicht committete Änderungen enthalten. Nie dort auschecken, stashen oder resetten. Gepusht wird per Refspec ohne Checkout, Prüfungen laufen in temporären Worktrees unter `/tmp`.
- `canary` bewegt sich nur per Fast-Forward auf `development`. Nie force-pushen, nie direkt auf `canary` committen.
- Der Push veröffentlicht sofort. Erst nach ausdrücklicher Bestätigung des Nutzers pushen.

## Ablauf

1. Stand prüfen:
   ```bash
   git fetch origin --prune --tags
   gh run list --workflow release.yml --branch canary --limit 3
   git log --oneline --no-merges origin/canary..origin/development
   git log --oneline origin/development..origin/canary
   git status -sb
   ```
   - Gibt es `origin/canary` noch nicht (erster Lauf), `origin/main` statt `origin/canary` für die Commit-Liste nehmen. Der Push legt den Branch an.
   - Commits, die nur auf `canary` liegen: abbrechen und melden. `canary` muss ein Vorfahre von `development` sein.
   - Keine neuen Commits auf `development`: nichts zu tun, Ende.
   - Ist das lokale `development` dem Remote voraus, nachfragen, ob diese Commits zuerst gepusht werden sollen.
   - Läuft gerade ein Canary-Lauf, melden. Ein neuer Push wartet, bis er fertig ist.
2. Version mit derselben Logik wie der Workflow berechnen:
   ```bash
   GITHUB_REF_NAME=canary node .github/scripts/release-plan.mjs origin/development
   ```
   - `Release vX.Y.Z-canary.N (previous vA.B.C)`: diese Version entsteht.
   - `No release: skip`: seit dem letzten Canary nichts mit Release-Wirkung. Melden und nur auf ausdrücklichen Wunsch trotzdem pushen; der Lauf endet dann ohne Release.
   - Fehler `… has commits missing on canary`: Ein Hotfix auf `main` fehlt in `development`. Zuerst `origin/main` nach `development` mergen (Hotfix-Abschnitt in `/release`), dann `/canary` neu starten.
3. CI des Ziel-Commits prüfen:
   ```bash
   gh run list --workflow ci.yml --branch development --commit "$(git rev-parse origin/development)" --limit 1 --json status,conclusion,url
   ```
   - `failure`: nicht pushen, Fehler melden.
   - Läuft noch oder fehlt: melden. Pushen ist trotzdem möglich, weil der Canary-Lauf die CI vor der Veröffentlichung selbst ausführt.
4. Dem Nutzer melden: erwartete Version, Highlights aus `feat`/`fix`/`perf` und CI-Status. Auf Bestätigung warten.
5. Nach Bestätigung pushen und den Lauf nennen:
   ```bash
   git push origin origin/development:refs/heads/canary
   gh run list --workflow release.yml --branch canary --limit 1
   ```
   Lehnt GitHub den Push ab (kein Fast-Forward), nicht forcen, sondern melden.

Schlägt ein Canary-Lauf fehl, den Fix normal auf `development` committen und erneut `/canary` ausführen. Der Entwurf des fehlgeschlagenen Laufs wird ersetzt; haben sich nur build-neutrale Dateien geändert, übernimmt der neue Lauf dessen Kompilate.
