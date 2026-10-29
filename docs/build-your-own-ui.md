# Build Your Own UI: UI-Plugins

Nutzer bauen Tabelle, Tab-Leiste und Split-Ansicht von l8db selbst um, meist per KI. Ein Plugin ist eine einzelne React-Datei gegen ein typisiertes SDK (`@l8db/ui`) mit festen Slots. l8db lädt jede Änderung sofort. Öffentliche Plugins mit Screenshots liegen in https://github.com/Leon-Achteresch/l8db-ui-plugins und sind in der App über eine Galerie installierbar und einstellbar.

## Für Nutzer

- *Einstellungen → Erweiterungen → UI-Plugins* zeigt die installierten Plugins mit Status und Optionen, Schaltern je Bereich und Netzwerkfreigaben. Darunter liegt die Galerie.
- **Mit KI bauen** kopiert eine Anleitung samt Ordnerpfad für einen KI-Agenten.
- **Ordner öffnen** öffnet den Plugin-Ordner.

| System | Plugin-Ordner |
|---|---|
| macOS, Linux | `~/.l8db/ui` |
| Windows | `%APPDATA%\.l8db\ui` |

## Slots

| Bereich | Slots |
|---|---|
| Tabelle | `grid.cell`, `grid.rowTone`, `grid.columns` |
| Tabellenansicht | `table.toolbar`, `table.detailTabs` |
| Tab-Leiste | `tabs.group`, `tabs.item`, `tabs.options` |
| Split-Ansicht | `split.layout`, `split.options`, `split.templates` |

Signaturen, Regeln, Grenzen und das Zusammenspiel mehrerer Plugins stehen in `packages/ui-plugin-api/folder-agents.md`. Dieselbe Datei legt l8db als `AGENTS.md` in den Plugin-Ordner; sie ist die Anleitung für KIs. Die Typen stehen in `packages/ui-plugin-api/l8db-ui.d.ts`.

Ohne Plugins verhält sich l8db wie vorher. Die Registry-Felder sind dann `null`, und der Grid-Kontext fehlt. Split-Layouts, automatische „Ansicht N“-Gruppen und der Schließen-Knopf behalten ihre Standardwerte.

## Ablauf

1. **Ordner** (`src-tauri/src/ui_plugins.rs`): `ui_plugins_scan` liest Dateien direkt im Ordner, nicht rekursiv.
   - Grenzen: höchstens 200 Dateien mit je 256 KB.
   - Nur `.tsx`, `.ts`, `.jsx` und `.js` zählen, `.d.ts` nicht.
   - `ui_plugins_watch` meldet Änderungen mit 120 ms Entprellung als `ui-plugins-changed`.
   - `ui_plugins_write`, `ui_plugins_remove` und `ui_plugins_write_support` schreiben Plugins und die Hilfsdateien: `AGENTS.md`, `CLAUDE.md`, `l8db-ui.d.ts`, `tsconfig.json` und `.status.json`.
2. **Start**: `src/features/ui-plugins/boot.ts` lädt den Host als eigenen Chunk erst nach dem ersten Render. Das Startpaket wächst dadurch um rund 9 KB.
3. **Übersetzen**: `packages/ui-plugin-api/src/compile.ts` prüft den Quelltext statisch und übersetzt ihn mit sucrase nach CommonJS. sucrase liegt in einem eigenen Chunk und wird erst geladen, wenn es etwas zu übersetzen gibt.
4. **Ausführen**: `evaluatePlugin` führt den Code mit `new Function` aus. Dabei sind gefährliche Globals verschattet und die Timer gezählt. `validatePlugin` prüft die Definition. Unveränderte Dateien (gleicher Hash) werden nicht neu übersetzt.
5. **Registry** (`src/lib/ui-plugins/registry.ts`): Sie fasst alle aktiven Plugins zu je einer Funktion pro Slot zusammen. Jeder Aufruf läuft durch einen `SlotGuard`.
6. **Live-Reload**: Hat eine neue Version einen Fehler, läuft die letzte funktionierende weiter (Status `stale`). `.status.json` meldet Fehler mit Zeile, Slot-Fehler und abgeschaltete Slots.

## Leitplanken

UI-Plugins laufen im Fenster von l8db. Die Leitplanken verhindern Versehen und offensichtlichen Missbrauch, sind aber keine Sandbox:

- **Imports:** nur `react` (kuratierte Liste, kein `createElement` und kein `use`) und `@l8db/ui`.
- **Gesperrte APIs:** `window`, `document`, `fetch`, `localStorage`, `eval`, `Function` und weitere sind schon bei der statischen Prüfung gesperrt und zur Laufzeit verschattet.
- **JSX:** Die Laufzeit lehnt `script`, `style`, `iframe`, `object`, `embed`, `link`, `meta`, `base`, `template` und Ähnliches ab, ebenso `dangerouslySetInnerHTML` und `ref`.
- **Zeilen:** Plugins bekommen eingefrorene Kopien ohne `__ctid__`. Maskierte Spalten sind schon maskiert.
- **Netzwerk:** Nur über `ctx.http`. Das Ziel muss in `permissions.http` stehen und von der Person freigegeben sein, und es gilt nur `https`.
- **Laufzeitbudgets (p95):**
  - `grid.cell` und `tabs.item`: 4 ms
  - `grid.rowTone` und `tabs.group`: 2 ms
  - `split.layout`: 10 ms
  - Toolbar, Detail-Tabs und Spalten: 50 ms

  Ein Slot, der sein Budget überschreitet oder 20-mal fehlschlägt, wird abgeschaltet.
- **Fehler in Plugin-Komponenten:** `PluginBoundary` fängt sie ab und zeigt den normalen Inhalt.
  - Die JSX-Laufzeit des SDK markiert diese Fehler (`markPluginError`).
  - `src/main.tsx` leitet markierte Fehler in `onCaughtError` und `onRecoverableError` auf `console.warn` um, damit sie nicht in Diagnose oder Absturzberichten landen.
- **Timer:** Timer eines Plugins werden beim Entladen aufgeräumt.

- **Hooks in Slots:** Ein Hook direkt in einer Slot-Funktion wirft einen Plugin-Fehler (`withoutHooks` in `modules.ts`), statt die Host-Komponente zu beschädigen.
- **Zeilen in Detail-Tabs und Toolbar:** Sie kommen aus dem View-Model, sind also aktuell und maskiert. Die gemeinsame Ablage (`table-slots.ts`) hält nur die Auswahl, höchstens für 20 Tabs. Sie liefert nur Zeilen, die noch in den aktuellen Daten stehen.

Die statische Prüfung arbeitet mit Tokens. Sie findet versehentliche Verstöße, aber keine absichtlichen Umgehungen, etwa über berechnete Eigenschaftsnamen, `Reflect` oder Event-Objekte (`event.view`). Plugins aus der Galerie prüft deshalb vor dem Merge ein Mensch. Installiere nur Plugins, deren Code du gelesen hast oder denen du vertraust.

## Einstellungen und Galerie

- **Gespeicherte Einstellungen:** `l8db.ui-plugins` (Zustand, `syncAcrossWindows`) enthält deaktivierte Plugins und Bereiche, Optionswerte, Netzwerkfreigaben und Installationen aus der Galerie.
- **Optionen:** Die Typen sind `boolean`, `text`, `number` und `select`. `resolveOptions` füllt Standardwerte, begrenzt Zahlen auf `min`/`max` und lässt bei `select` nur die erlaubten Werte zu.
- **Galerie** (`src/lib/ui-plugins/catalog.ts`): Sie lädt `https://raw.githubusercontent.com/Leon-Achteresch/l8db-ui-plugins/catalog/catalog.json` (höchstens 512 KB) und die Screenshots (höchstens 2 MB).
- **Installation:**
  - Vor der Installation prüft die Galerie den SHA-256 jeder Plugin-Datei (höchstens 256 KB) gegen den Katalog.
  - Danach prüft sie das Plugin wie beim Laden.
  - Zuletzt schreibt sie es als `<id>.tsx` in den Ordner.
  - Ändert sich der Hash oder steigt die Version, bietet sie „Aktualisieren“ an.

## Öffentliches Repo

`Leon-Achteresch/l8db-ui-plugins` enthält `plugins/<id>/plugin.tsx` mit `screenshot.png`, `sdk/` (Kopie von `packages/ui-plugin-api`, geholt mit `bun run sync-sdk`) und die Prüfskripte. `AGENTS.md` dort beschreibt den Ablauf für Beiträge.

`bun run check` prüft Folgendes:

- **Übersetzen:** Jedes Plugin wird mit denselben Modulen wie in l8db übersetzt und ausgeführt.
- **Slots:** Jeder Slot läuft mit den Beispieldaten aus `scripts/samples.ts` und jeder Optionsvariante, und jede Ausgabe wird gerendert.
- **Budget:** Für `grid.cell` gilt p95 < 2 ms.
- **Abdeckung:** Jeder Slot muss mit den Beispieldaten mindestens einmal etwas liefern.
- **Dateien:** Metadaten, Ordnername gleich `id` und ein eigener Screenshot, also keine Kopie eines anderen Plugins.
- **README:** Die generierte Plugin-Liste in `README.md` ist aktuell.

Die Workflows im Repo:

- `.github/workflows/check.yml` prüft jeden Pull Request.
- `.github/workflows/publish.yml` baut nach jedem Push auf `main` mit `bun run catalog` den Katalog und hängt ihn als Commit an den Branch `catalog`, ohne Force-Push.

Screenshots aus der echten App erzeugt dieses Repo:

```sh
bun run build
bun scripts/ui-plugin-screenshots.ts ../l8db-ui-plugins          # alle Plugins und overview.png
bun scripts/ui-plugin-screenshots.ts ../l8db-ui-plugins <id>     # ein Plugin
```

Für ein neues Plugin gehört eine Szene in `SCENES`. Das Format ist 1440×860 bei DPR 2 im hellen Theme. Die Demo-Daten stammen aus `tests/fixtures/ui-plugins-app.ts`.

## Tests

| Test | Inhalt |
|---|---|
| `tests/ui-plugins-compile.test.ts` | statische Prüfung, Übersetzen, Definition, Katalog |
| `tests/ui-plugins-runtime.test.ts` | Host, Live-Reload, Registry, Guard, Tab-Policy, Grid, Netzwerk, Vorlagen, Katalog, Fehlermarkierung |
| `tests/perf-ui-plugins.test.ts` | Zellkosten, Ladezeiten, Speicher- und Leerlaufgrenzen (Teil von `bun run test:perf:core`) |
| `tests/ui-plugins-browser.test.ts` | alle Slots in der gebauten App mit CSP, Live-Reload, defektes Plugin, Einstellungen, Installation aus der Galerie; ohne Seiten- oder Konsolenfehler |
| `src-tauri/src/ui_plugins.rs` | Rust-Tests für Ordner, Grenzen und Dateinamen |

Der Browser-Test läuft nach `bun run build`:

```sh
L8DB_UI_PLUGINS_BROWSER=1 bun test tests/ui-plugins-browser.test.ts
L8DB_UI_PLUGINS_BROWSER=webkit bun test tests/ui-plugins-browser.test.ts
```

Messwerte vom 29.10.2026 (Apple M3, 16 GB, macOS 27.0.1 arm64, Bun 1.4.3):

- **Zellen:** 5 Plugins auf 2.000 Zeilen × 24 Spalten.
  - Je Zelle p95 1,9 µs, Budget 5 µs.
  - Sichtbares Fenster mit 480 Zellen: p95 1,0 ms, Budget 3 ms.
- **Laden:** 30 Plugins (118 KB).
  - Kaltstart p95 26–36 ms, Budget 150 ms.
  - Unverändertes Neuladen p95 0,2 ms, Budget 2 ms.
  - Eine geänderte Datei p95 1,0 ms, Budget 15 ms.
- **Grenzen:**
  - Gespeicherte Auswahl: 20 von 1.000 Tabs.
  - 50.000 eingefrorene Zeilen behalten etwa 1,1 MB (Budget 8 MB).
  - `Board` rendert 1.000 von 400.000 angebotenen Einträgen.
  - Im Leerlauf gibt es keine Backend-Aufrufe.

Windows ist nicht getestet. Die Laufzeitmessungen mit gedrosselter CPU laufen in `.github/workflows/performance.yml`.
