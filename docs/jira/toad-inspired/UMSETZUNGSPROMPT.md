# Auftrag: Toad-Backlog L8DB-PLAN-001 bis 075 umsetzen

Du bist die Orchestrator-KI für das l8db-Repo (`/Users/leon/l8db`, Tauri v2 + React 19 + Rust).
Ziel: Alle 75 Tickets in `docs/jira/toad-inspired/L8DB-PLAN-*.md` implementieren.
Du implementierst NICHT selbst im Detail — du steuerst Subagenten (Task-Tool) und hältst deinen
eigenen Kontext minimal. Single Source of Truth: die Ticket-Dateien + `docs/jira/toad-inspired/README.md`
(Umsetzungsrahmen) + `AGENTS.md`.

## 0. Setup (einmalig, du selbst, keine Subagenten)

1. `git status` muss sauber sein. Lege Branch `feat/toad-backlog` an.
2. Lies EINMAL: `docs/jira/toad-inspired/README.md`, `AGENTS.md`.
3. Baue aus der README-Tabelle den Abhängigkeitsgraphen („Benötigt“-Spalte) und bilde Wellen:
   sequentiell bei Abhängigkeiten, sonst frei kombinierbar. Bekannte Ketten z. B.:
   001→002, 006→007→008, 009→010, 011→012, 013→014, 018→019, 021→022, 023→024,
   030→031/032/033, 034→035→036, 041→042, 045→046→047, 049→050, 054→055, 056→057,
   039→063, 041→067/072, 070→071→068, 045/047→073, 043/044/057→074, 020/039→066.
4. Starte EINEN Recherche-Subagenten (read-only, Gründlichkeit „quick“): erstelle eine
   Codebase-Karte (max. 40 Zeilen: wichtigste Frontend-Features, Backend-Module,
   Bridge `src/lib/db.ts`, Capability-System). Diese Karte + Ticket-Text ist das EINZIGE
   Kontextpaket, das Implementierungs-Subagenten je bekommen.
5. Lege `<repo-root>/chat/` + `chat/archiv/` an (siehe §7) und trage `chat/` in
   `.gitignore` ein.

## 1. Subagenten-Regeln (wichtigste Token-Hebel)

- **Kontext-Isolation:** Jeder Implementierungs-Subagent bekommt NUR: Ticket-Text,
  Codebase-Karte (aus Schritt 0.4), 8-Zeilen-Regeldigest (siehe §2), Chat-Digest
  (max. 5 Zeilen, siehe §7) und die Pfade aus „Code-Anknüpfung“ des Tickets.
  NIEMALS ganze Dateien in den Prompt kopieren.
- **Recherche parallel, Implementierung sequentiell:** Pro Welle dürfen beliebig viele
  read-only-Recherchen parallel laufen. Implementierungs-Subagenten EINZELN nacheinander
  starten (gleicher Working-Tree → sonst Konflikte). Ausnahme: max. 3 parallel, nur wenn
  ihre „Code-Anknüpfung“-Dateimengen nachweislich disjunkt sind.
- **Kleine Tickets bündeln:** 1–2-SP-Tickets mit gleicher Code-Anknüpfung in EINEN
  Subagenten-Call packen (z. B. 061+020, 017+062, 049+050, 034→035→036-Kette am Stück).
- **Lese-Budget pro Subagent:** max. ~10 Datei-Reads, gezielt mit Offset/Limit, davor
  immer Grep/Glob statt Blättern. `routeTree.gen.ts` nie anfassen, `node_modules/`, `dist/`
  und `.git/` nie lesen. Keine `tauri dev/build`, kein `bun install`.
- **Rückgabevertrag (strikt, max. 25 Zeilen):** Geänderte Dateien (Liste) + Diff-Stat +
  Prüfergebnisse (Befehle + ok/fail) + offene Punkte. Kein Code im Report, keine
  Erklärtexte. Details stehen im Git-Commit.
- **Contract-Pflicht:** Wer eine gemeinsam genutzte Schnittstelle (`src/lib/db.ts`,
  `provider.rs`, `mod.rs`, `queries.ts`, Capabilities) ändert oder erweitert, schreibt VOR
  dem Fertigmelden eine `contract`-Nachricht nach §7.
- **Claim-Pflicht bei Parallelität:** Parallele Agenten prüfen vor jedem Edit an gemeinsam
  genutzten Dateien per `ls chat/ | grep claim`, ob die Datei frei ist — bei Konflikt lässt
  der Agent mit der höheren Ticketnummer die Datei aus und meldet das im Report.
- **Review durch dich:** Kein Nachlesen der Implementierung — nur `git diff --stat` und
  bei Bedarf `git diff <eine Datei>`. Stichproben: 1 Datei pro 3 Tickets.

## 2. Regeldigest (wörtlich in jeden Implementierungs-Prompt übernehmen)

> Stack: React19/TS/Vite + Rust/Tauri. 1 Komponente pro Datei, KEINE Code-Kommentare.
> Neue invoke()-Calls nur über `src/lib/db.ts`, TS-/Rust-Typen synchron halten.
> Neue DB-Features nur hinter Capability (`supports()`/`useActiveCapabilities()`), nie Kind hardcoden.
> Immer `effectiveConnectionString()` (SSH), nie Direct-Fallback. Kein Secret außer Keychain.
> Transaktionsverwaltung respektieren. Bestehendes erweitern, nichts parallel neu bauen.
> Prüfungen: Frontend `npx tsc -p tsconfig.app.json --noEmit`; Backend `cargo check`
> (bei Änderung), `cargo clippy` pro Welle. Tests nur für berührten Code schreiben/ausführen.

## 3. Verifikation (gestaffelt = billig)

- **Pro Ticket** (Subagent): nur betroffene Seite prüfen (tsc bei .ts/.tsx, `cargo check`
  bei .rs) + zugehörige Tests. Volle Suiten NIE pro Ticket.
- **Pro Welle** (du selbst, 1 Batch): `npx tsc -p tsconfig.app.json --noEmit`,
  `bun run test`, `cargo check`, `cargo clippy`. Erst bei Grün nächste Welle.

## 4. Fortschritt & Commits

- Pro Ticket (oder Bündel) genau EIN Commit: `feat(L8DB-PLAN-0xx): <Ticket-Titel>`.
- Danach im Ticket-File die Zeile `Status: Vorschlag` → `Status: Umgesetzt` flippen
  (1 Edit). Das ist der persistente Ledger — ein Resume beginnt mit
  `grep "Status: Vorschlag" docs/jira/toad-inspired/`.
- Deine TodoWrite-Liste führt nur die Wellen, nicht 75 Einzeltickets.

## 5. Blockaden-Budget

Max. 2 Reparaturversuche pro Ticket (Subagent meldet Fail → 1 gezielter Fix-Retry mit
Fehlerlog-Ausschnitt, max. 15 Zeilen). Danach: `Status: Blockiert (<Grund>)` setzen,
als `blocker`-Nachricht nach §7 posten lassen, Commit skippen, mit unabhängigem Ticket
fortfahren. Blockierte Tickets am Ende in EINER Welle mit vollem Fehlerkontext erneut
versuchen.

## 6. Done-Definition pro Ticket

Alle Akzeptanzkriterien erfüllt · „Nicht enthalten“ respektiert · Checks aus §3 grün ·
Status-Zeile geflippt · genau 1 Commit. Melde am Ende: umgesetzt / blockiert (mit Grund) /
bewusst übersprungen — als Tabelle, eine Zeile pro Ticket.

## 7. Agenten-Chat (`chat/`-Ordner)

Subagenten können NICHT direkt miteinander sprechen. Der file-basierte `chat/`-Ordner ist
das EINZIGE erlaubte Kommunikationsmittel zwischen Agenten.

**Setup (Orchestrator, einmalig in Schritt 0.5):**

- `<repo-root>/chat/` + `chat/archiv/` anlegen, `chat/` in `.gitignore` eintragen
  (Chat-Müll wird nie committet). Bei Projektende `chat/` löschen.

**Nachricht schreiben (Subagent):**

- Dateiname: `HHMMSS-<eigenesTicket>-an-<alle|TicketNr>-<art>.md`
  (Bsp: `143022-070-an-alle-contract.md`, `143105-071-an-070-frage.md`)
- Template, max. 12 Zeilen, KEIN Code außer 1-Zeilen-Signaturen, KEINE Logs > 10 Zeilen:
  `# <Art>: <Betreff, max. 6 Wörter>` / `Von: / An: / Welle:` /
  `Kontext: (max. 2 Zeilen)` / `Aktion nötig von: <wem, bis wann>`
- Erlaubte Arten: `claim` (editiere jetzt Datei X — PFLICHT vor Änderung gemeinsam
  genutzter Dateien: `src/lib/db.ts`, `provider.rs`, `mod.rs`, `queries.ts`, `monaco.ts`),
  `contract` (Schnittstelle geändert/erweitert: Command-/Capability-/Funktionsname +
  1-Zeilen-Signatur), `frage`, `antwort` (max. 2 Runden, danach entscheidet der Orchestrator),
  `blocker` (Ticket Y blockiert, braucht Z).
- VOR dem Schreiben: `ls chat/` + `grep -l "<Stichwort>" chat/*.md` — bereits
  beantwortete Fragen NICHT erneut stellen.

**Nachrichten lesen (Subagent, zu Beginn, max. 2 Tool-Calls):**

- Nur Nachrichten an `alle` oder ans eigene Ticket, neuer als der eigene Start.
- Zuerst nur Betreffzeilen (`head -1 chat/*.md`), Volltext nur bei Treffer, max. 5 Stück.
  Danach SOFORT arbeiten — kein Warten auf Antworten (Fragen parallel zur Arbeit stellen,
  Antwort kommt via Orchestrator in den Fix-Retry).

**Orchestrator-Pflichten:**

- Vor jedem Subagenten-Start relevante Einträge zu max. 5 Zeilen Digest verdichten und in
  den Prompt einbetten — im Idealfall muss der Subagent `chat/` gar nicht selbst lesen.
- Offene `frage`-Nachrichten zwischen den Wellen beantworten oder entscheiden.
- Am Wellenende Erledigtes nach `chat/archiv/` verschieben (Ordner klein = billiges `ls`).
