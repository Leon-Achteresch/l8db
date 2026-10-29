# l8db UI-Plugins (Build Your Own UI)

Dieser Ordner gehört l8db. Jede Datei `*.tsx`, `*.ts`, `*.jsx` oder `*.js` direkt hier ist ein UI-Plugin. l8db lädt Änderungen sofort, ohne Neustart. `AGENTS.md`, `CLAUDE.md`, `l8db-ui.d.ts`, `tsconfig.json` und `.status.json` schreibt l8db selbst; ändere sie nicht.

## So arbeitest du

1. Datei anlegen oder ändern, z. B. `status-pills.tsx`.
2. `.status.json` lesen. Dort steht je Datei ein `state`: `active`, `error`, `stale` oder `disabled`. Bei Fehlern kommen `error.message` und `error.line` dazu, zur Laufzeit `slotErrors` und `tripped`. `stale` heißt: Die neue Version hat einen Fehler, und die letzte funktionierende läuft weiter.
3. Erst fertig melden, wenn deine Datei `active` ist und weder `slotErrors` noch `tripped` hat.

Alle Typen und Signaturen stehen in `l8db-ui.d.ts`. Für einen optionalen Typcheck `npm i -D typescript @types/react` und dann `npx tsc` ausführen; l8db ignoriert `package.json` und `node_modules`. Beispiele liegen unter https://github.com/Leon-Achteresch/l8db-ui-plugins.

## Regeln

- Ein Plugin ist genau eine Datei. Imports sind nur aus `react` und `@l8db/ui` erlaubt.
- Verboten sind `document`, `window`, `fetch` und `localStorage`, die Elemente `<style>`, `<script>` und `<iframe>`, `dangerouslySetInnerHTML` und `ref` auf HTML-Elementen. Netzwerk geht nur über `ctx.http` mit `permissions.http`, und die Person muss das Ziel in l8db freigeben.
- Slot-Funktionen sind reine Funktionen, also keine Hooks direkt in `cell`, `rowTone`, `columns`, `group`, `item`, `layout` oder `run`. Hooks gehören in eigene Komponenten, die du als JSX zurückgibst, etwa `render: (props) => <Stats {...props} />`.
- `cell` läuft für jede sichtbare Zelle jeder Tabelle. Gib früh `undefined` zurück, wenn Tabelle oder Spalte nicht passen. Braucht `cell` im p95 über 4 ms, schaltet l8db den Slot ab. Werte können Tausende Zeichen lang sein, daher keine verschachtelten Regex-Wiederholungen.
- Werte sind `unknown`. Wandle sie mit `asText`, `asNumber`, `asDate` oder `daysFromToday` um. Zeilen sind schreibgeschützte Kopien. Maskierte Spalten kommen schon maskiert an, z. B. `***`, `a***z`, als Hash oder als Ersatzwert.
- Rückgabe `undefined` heißt „nicht zuständig“: Dann ist das nächste Plugin dran, sonst zeigt l8db den normalen Inhalt. `null` oder `""` ergeben eine leere Zelle.

## Grundgerüst

```tsx
import { definePlugin, Pill, type Tone } from "@l8db/ui";

const TONE: Record<string, Tone> = { offen: "warning", bezahlt: "success", storniert: "danger" };

export default definePlugin({
  id: "meinname.status-pills",
  name: "Status als Pills",
  description: "Färbt die Spalte status in sales.orders.",
  version: "1.0.0",
  author: "meinname",
  slots: {
    grid: {
      cell: ({ table, column, value }) =>
        table.id === "sales.orders" && column.id === "status" ? (
          <Pill tone={TONE[String(value)] ?? "neutral"}>{String(value)}</Pill>
        ) : undefined,
    },
  },
});
```

Die `id` hat die Form `herausgeber.name` und besteht aus Kleinbuchstaben, Ziffern und `-`.

## Optionen

Mit `options` kann jede Person das Plugin in l8db einstellen, unter Einstellungen → Erweiterungen → UI-Plugins. Es gibt die Typen `boolean`, `text`, `number` (mit `min`, `max`, `step`) und `select` (mit `choices`).

`slots` ist dann eine Funktion `(options) => ({ ... })`. Sie läuft beim Laden und bei jeder Änderung einer Option. Bereite Listen, `Set`s und Maps dort einmal vor, nicht in `cell`. Dieselben Werte stehen auch in `props.options` und `ctx.options`.

`options` ist immer vollständig, und jede Option hat ihren Typ: `boolean` ist ein Boolean, `number` eine Zahl, `text` und `select` sind Texte. Fehlende oder ungültige Werte ersetzt l8db durch `default`. Zahlen werden auf `min`/`max` begrenzt, und `select` liefert nur Werte aus `choices`. Ein Textfeld kann leer sein.

```tsx
options: { columns: { type: "text", label: "Spalten", default: "status,state" } },
slots: (options) => {
  const names = new Set(String(options.columns).split(",").map((name) => name.trim()).filter(Boolean));
  return { grid: { cell: ({ column, value }) => (names.has(column.id) ? <Pill>{String(value)}</Pill> : undefined) } };
},
```

## Slots

| Slot | Signatur | Wirkung |
|---|---|---|
| `grid.cell` | `(props) → ReactNode \| undefined` | Inhalt der Zelle. `props`: `value`, `row`, `column`, `table`, `rowIndex`, `rows`, `options` |
| `grid.rowTone` | `(row, table) → Tone \| undefined` | Färbt die Zeile. |
| `grid.columns` | `(table, columns) → ColumnPatch[]` | Standard-Layout aus `{ id, hidden?, pinned?, order?, width? (40–1200), label?, align? }`. Spalten mit `order` stehen vorne, aufsteigend sortiert. Eigene Anpassungen der Person gehen vor. |
| `table.toolbar` | `(table) → { id, label, tone?, run(ctx) }[]` | Knöpfe in der Tabellen-Toolbar |
| `table.detailTabs` | `(table) → { id, label, render(props) }[]` | Eigene Tabs neben „Daten“ und „Spalten“ |
| `tabs.group` | `(tab) → { id, label, tone? } \| undefined` | Beschriftete Gruppen in der Tab-Leiste |
| `tabs.item` | `({ tab, active, Default }) → ReactNode` | Inhalt eines Tabs. `<Default />` zeigt Icon und Titel, `active` ist `true` beim ausgewählten Tab. |
| `tabs.options` | `{ closeButton?: "auto" \| "always" \| "hover" \| "never", newTabPosition?: "end" \| "afterActive" }` | Verhalten der Tab-Leiste |
| `split.layout` | `(count, orientation) → "columns" \| "rows" \| "leftStack" \| "topStack" \| "grid"` | Anordnung bei 2–4 Bereichen |
| `split.options` | `{ autoSaveGroups?: boolean }` | Mit `false` legt Teilen keine Gruppe „Ansicht N“ an. |
| `split.templates` | `{ id, name, when?, orientation?, panes }[]` | Vorlagen im Menü „Tab-Gruppen“ |

Details zu den Tabs:

- `tabs.group` und `tabs.item` sehen nur ihren eigenen Tab, nicht die anderen.
- Gruppen sortieren keine Tabs um. l8db zeigt das Label über jeder Folge benachbarter Tabs derselben Gruppe.
- Ein neuer Tab reiht sich hinter dem letzten Tab seiner Gruppe ein.

Details zu den Vorlagen:

- `panes` enthält 2–4 Bereiche der Form `{ table: "schema.tabelle", master?, link? }`.
- `master` ist der Index (ab 0) des Bereichs, dessen ausgewählte Zeile filtert.
- `link: { column, masterColumn? }` filtert den Bereich, wobei `column` im eigenen Bereich und `masterColumn` im Master liegt. Ohne `masterColumn` gilt derselbe Name.
- `orientation` ist `horizontal` (nebeneinander, Standard) oder `vertical` (untereinander).
- `when: { connectionTag?, connectionName? }` zeigt die Vorlage nur passenden Verbindungen. `connectionName` vergleicht den ganzen Namen, `*` ist Platzhalter, und Groß- und Kleinschreibung zählt nicht. Bei einer Liste reicht ein Treffer. Stehen Tag und Name beide da, muss beides passen.

`ctx` in `run` und `props` in `render` enthalten:

- `table` und `columns`;
- `selection`: die markierten Zeilen, sonst die aktive Zeile;
- `rows`: alle geladenen Zeilen, gefiltert und sortiert. Es bleibt dasselbe Array, bis sich die Daten ändern, und passt deshalb für `useMemo`;
- `options`, `toast(text, tone?)`, `http(url, init?)` und `openTable("schema.tabelle")`.

`run` hat zusätzlich `copy(text)` und `refresh()`.

`table` = `{ id: "schema.tabelle", schema, name, database, kind, connection: { id, name, kind, environment, tags, readOnly } }`. `column` = `{ id, type, label, primaryKey }`. `id` ist der echte Spaltenname, `type` der Typname der Datenbank, z. B. `integer`, `numeric`, `timestamp with time zone`, `character varying`, `jsonb` oder `text[]`. Prüfe ihn mit einem Regex. Postgres liefert `numeric` und `bigint` als Text, JSON als Objekt und Arrays als Array.

Grenzen:

- Zeichen: `name` 80, `description` 500, Labels von Aktionen, Detail-Tabs und Gruppen 40, Vorlagennamen 60.
- Anzahl: höchstens 30 Optionen, 12 Aktionen, 8 Detail-Tabs und 20 Vorlagen.

## Bausteine

- Komponenten: `Pill`, `Badge`, `Check`, `RelativeTime`, `Text` (`mono`, `tone`), `Stack`, `Button`, `Card`, `Columns`, `Bar`, `List` (mit `limit`), `Board` (Kanban, mit `limit` je Spalte) und `Empty`.
- Töne: `neutral`, `info`, `success`, `warning` und `danger`.
- Mehrere Elemente in einer Zelle stehen als Fragment `<>…</>` nebeneinander.

Hilfen:

- `asText`: aus `null` wird `""`, Objekte werden JSON.
- `asNumber`: Zahlen, Zahltexte wie `"12.5"` oder `"1e3"`, `bigint` und Booleans werden Zahlen. `""`, `"12abc"`, `NaN` und `Infinity` ergeben `null`.
- `asDate`: akzeptiert `Date`, Millisekunden und ISO-Texte. Was es nicht lesen kann, ergibt `null`.
- `daysFromToday`: ganze Tage, negativ heißt Vergangenheit.
- `formatNumber(value, { decimals?, currency? })` formatiert deutsch. Was keine Zahl ist, kommt als Text zurück.
- `formatDate(value, { time? })`.

Eigenes JSX mit HTML-Elementen, `style` und Ereignissen wie `onClick` oder `onChange` ist erlaubt. Nimm `style` statt `className`. Für Farben passen die Theme-Variablen `var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--muted)` und `var(--primary)`. Jede Ausgabe bleibt in ihrer Zelle bzw. ihrem Bereich eingeschlossen und kann nichts überdecken.

## Mehrere Plugins

l8db lädt die Dateien nach Namen sortiert.

- Bei `grid.cell`, `grid.rowTone`, `tabs.group` und `split.layout` gewinnt die spätere Datei. Liefert sie `undefined`, ist die frühere dran.
- `grid.columns` wird je Spalte zusammengeführt.
- `table.toolbar`, `table.detailTabs` und `split.templates` werden addiert.
- `tabs.item` kommt aus der letzten Datei, die es setzt.
- Bei `tabs.options` und `split.options` gewinnt je Feld die spätere Datei.

## Teilen

Gute Plugins mit Screenshot per Pull Request an https://github.com/Leon-Achteresch/l8db-ui-plugins schicken. Nach dem Merge können alle sie in l8db unter Einstellungen → Erweiterungen → UI-Plugins installieren.
