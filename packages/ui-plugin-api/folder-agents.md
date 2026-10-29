# l8db UI-Plugins (Build Your Own UI)

Dieser Ordner gehört l8db. Jede Datei `*.tsx`, `*.ts`, `*.jsx` oder `*.js` direkt hier ist ein UI-Plugin. l8db lädt Änderungen sofort, ohne Neustart. `AGENTS.md`, `CLAUDE.md`, `l8db-ui.d.ts`, `tsconfig.json` und `.status.json` schreibt l8db selbst; ändere sie nicht.

## So arbeitest du

1. Datei anlegen oder ändern, z. B. `status-pills.tsx`.
2. `.status.json` lesen. Dort steht je Datei ein `state`: `active`, `error`, `stale` oder `disabled`. Bei Fehlern kommen `error.message` und `error.line` dazu, zur Laufzeit `slotErrors` und `tripped`. `stale` heißt: Die neue Version hat einen Fehler, und die letzte funktionierende läuft weiter.
3. Erst fertig melden, wenn deine Datei `active` ist und weder `slotErrors` noch `tripped` hat.

Alle Typen, Signaturen und Props der Bausteine stehen in `l8db-ui.d.ts`. Für einen optionalen Typcheck `npm i -D typescript @types/react` und dann `npx tsc` ausführen; l8db ignoriert `package.json` und `node_modules`. Beispiele liegen unter https://github.com/Leon-Achteresch/l8db-ui-plugins.

## Regeln

- Ein Plugin ist genau eine Datei. Imports sind nur aus `react` und `@l8db/ui` erlaubt. Aus `react` gibt es nur `Children`, `Fragment`, `createContext`, `isValidElement`, `memo`, `startTransition`, `useCallback`, `useContext`, `useDeferredValue`, `useEffect`, `useId`, `useMemo`, `useReducer`, `useRef`, `useState` und `useTransition`.
- Gesperrte globale Namen, auch als eigene Variablen oder Parameter: `window`, `document`, `globalThis`, `frames`, `opener`, `navigator`, `localStorage`, `sessionStorage`, `indexedDB`, `caches`, `cookieStore`, `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `Worker`, `SharedWorker`, `ServiceWorker`, `BroadcastChannel`, `importScripts`, `eval`, `Function`, `require`, `process`, `module` und `exports`. Nach einem Punkt (`row.document`) und als Objektschlüssel (`{ fetch: 1 }`) sind sie erlaubt.
- Überall gesperrt, auch als Schlüssel oder eigener Name: `constructor`, `prototype`, `__proto__`, `__defineGetter__` und Verwandte, `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `insertAdjacentElement`, `dangerouslySetInnerHTML`, `createElement`, `createPortal`, `ownerDocument`, `defaultView`, `parentNode`, `parentElement`, `getRootNode`, `offsetParent`, `closest`, `contentWindow`, `contentDocument` und `srcdoc`.
- `self`, `top`, `parent`, `location`, `history`, `open`, `alert`, `confirm`, `prompt` und `postMessage` sind im Plugin `undefined`. Als eigene Namen darfst du sie verwenden.
- Verbotene Elemente: `<script>`, `<style>`, `<iframe>`, `<frame>`, `<frameset>`, `<object>`, `<embed>`, `<link>`, `<meta>`, `<base>`, `<portal>` und `<template>`, außerdem `ref` auf HTML-Elementen. Netzwerk geht nur über `ctx.http`, siehe „Netzwerk“.
- Slot-Funktionen sind reine Funktionen, also keine Hooks direkt in `cell`, `rowTone`, `columns`, `toolbar`, `detailTabs`, `group`, `item`, `layout` oder `run`. Hooks gehören in eigene Komponenten, die du als JSX zurückgibst, etwa `render: (props) => <Stats {...props} />`.
- Laufzeitbudgets im p95: `cell` und `item` 4 ms, `rowTone` und `group` 2 ms, `layout` 10 ms, alle anderen 50 ms. Ein Slot, der sein Budget überschreitet oder 20-mal wirft, wird abgeschaltet (`tripped`).
- `cell` läuft für jede sichtbare Zelle jeder Tabelle. Gib früh `undefined` zurück, wenn Tabelle oder Spalte nicht passen. Werte können Tausende Zeichen lang sein, daher keine verschachtelten Regex-Wiederholungen.
- Werte sind `unknown`. Wandle sie mit `asText`, `asNumber`, `asDate` oder `daysFromToday` um. Zeilen sind schreibgeschützte Kopien. Jede geladene Spalte ist ein Schlüssel, auch ausgeblendete, und NULL ist `null`. Maskierte Spalten kommen schon maskiert an, z. B. `***`, `a***z`, als Hash oder als Ersatzwert; ob eine Spalte maskiert ist, sieht das Plugin nicht.
- Nachschlagetabellen baust du mit `Map` oder `Set`, nicht mit Objektliteralen: Ein Wert wie `"constructor"` träfe sonst eine geerbte Eigenschaft.
- Rückgabe `undefined` heißt „nicht zuständig“: Dann ist das nächste Plugin dran, sonst zeigt l8db den normalen Inhalt. `null` oder `""` ergeben eine leere Zelle.

## Grundgerüst

```tsx
import { definePlugin, Pill, type Tone } from "@l8db/ui";

const TONE = new Map<string, Tone>([
  ["offen", "warning"],
  ["bezahlt", "success"],
  ["storniert", "danger"],
]);

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
          <Pill tone={TONE.get(String(value)) ?? "neutral"}>{String(value)}</Pill>
        ) : undefined,
    },
  },
});
```

Die `id` hat die Form `herausgeber.name` mit bis zu vier Teilen. Jeder Teil besteht aus Kleinbuchstaben, Ziffern und `-` und beginnt nicht mit `-`.

## Optionen

Mit `options` kann jede Person das Plugin in l8db einstellen, unter Einstellungen → Erweiterungen → UI-Plugins. Jede Option hat `type`, `label` und optional `description` und `default`. Die Typen:

- `boolean`;
- `text`, optional mit `placeholder`;
- `number`, optional mit `min`, `max` und `step`;
- `select` mit `choices`, und `default` muss einer davon sein.

Schlüssel bestehen aus Buchstaben, Ziffern und `_` und beginnen mit einem Buchstaben.

`slots` ist dann eine Funktion `(options) => ({ ... })`. Sie läuft beim Laden und bei jeder Änderung einer Option. Bereite Listen, `Set`s und Maps dort einmal vor, nicht in `cell`. Dieselben Werte stehen auch in `props.options` und `ctx.options`.

`options` ist immer vollständig:

- Fehlende oder ungültige Werte ersetzt l8db durch `default`. Ohne `default` gilt `false`, `""`, `min` (sonst 0) bzw. die erste Auswahl.
- Zahlen werden auf `min`/`max` begrenzt; ohne `min`/`max` bleiben sie unbegrenzt. `select` liefert nur Werte aus `choices`.
- Ein Textfeld kann leer sein, ein leerer Text bleibt leer. Es hat höchstens 500 Zeichen.
- In TypeScript ist jeder Wert `string | number | boolean`. Grenze ihn mit `=== true`, `Number(...)` oder `asText(...)` ein.

```tsx
options: { columns: { type: "text", label: "Spalten", default: "status,state" } },
slots: (options) => {
  const names = new Set(asText(options.columns).split(",").map((name) => name.trim()).filter(Boolean));
  return { grid: { cell: ({ column, value }) => (names.has(column.id) ? <Pill>{String(value)}</Pill> : undefined) } };
},
```

## Slots

| Slot | Signatur | Wirkung |
|---|---|---|
| `grid.cell` | `(props) → ReactNode \| undefined` | Inhalt der Zelle. `props`: `value`, `row`, `column`, `table`, `rowIndex`, `rows`, `options` |
| `grid.rowTone` | `(row, table) → Tone \| undefined` | Färbt die ganze Zeile in der Farbe des Tons. Farbregeln der Person gehen vor. |
| `grid.columns` | `(table, columns) → ColumnPatch[] \| undefined` | Standard-Layout aus `{ id, hidden?, pinned?, order?, width? (40–1200), label?, align? }`. `pinned: true` heftet links an; angeheftete Spalten stehen ganz vorne, untereinander nach `order`. Danach folgen Spalten mit `order`, aufsteigend sortiert. Nicht gesetzte Felder lassen die Spalte, wie sie ist, also liefere nur Spalten, die du änderst. Eigene Anpassungen der Person gehen vor. |
| `table.toolbar` | `(table) → { id, label, tone?, run(ctx) }[] \| undefined` | Knöpfe in der Tabellen-Toolbar |
| `table.detailTabs` | `(table) → { id, label, render(props) }[] \| undefined` | Eigene Tabs neben „Daten“ und „Spalten“ |
| `tabs.group` | `(tab) → { id, label, tone? } \| undefined` | Beschriftete Gruppen in der Tab-Leiste |
| `tabs.item` | `({ tab, active, Default }) → ReactNode \| undefined` | Inhalt eines Tabs. `<Default />` zeigt Icon und Titel. `active` ist `true` beim ausgewählten Tab. Den Schließen-Knopf steuert `tabs.options`. |
| `tabs.options` | `{ closeButton?, newTabPosition? }` | Verhalten der Tab-Leiste |
| `split.layout` | `(count, orientation) → SplitLayout \| undefined` | Anordnung bei 2–4 Bereichen |
| `split.options` | `{ autoSaveGroups?: boolean }` | Standard `true`: Teilen merkt sich die Anordnung als Gruppe „Ansicht N“. `false` schaltet das ab. |
| `split.templates` | `{ id, name, when?, orientation?, panes }[]` | Vorlagen im Menü „Tab-Gruppen“ |

Details zur Tab-Leiste:

- `tab` ist `{ key, kind, title, connection, table }`. `connection` und `table` sind bei Tabs ohne Verbindung oder Tabelle `null`, und `connection.environment` ist `production`, `staging`, `test`, `development` oder `null`.
- `tabs.group` und `tabs.item` sehen nur ihren eigenen Tab, nicht die anderen.
- Gruppen sortieren keine Tabs um. l8db zeigt das Label über jeder Folge benachbarter Tabs derselben Gruppe. Ein neuer Tab reiht sich hinter dem letzten Tab seiner Gruppe ein.
- `closeButton` legt fest, wann der Schließen-Knopf sichtbar ist:
  - `auto` (Standard): am aktiven Tab und beim Überfahren;
  - `hover`: nur beim Überfahren;
  - `always`: immer;
  - `never`: nie.
- `newTabPosition`: `end` (Standard) hängt neue Tabs hinten an, `afterActive` setzt sie hinter den aktiven Tab.

Details zur Split-Ansicht:

- Die Layouts:
  - `columns`: alle Bereiche nebeneinander;
  - `rows`: alle untereinander;
  - `leftStack`: ein Bereich links, die übrigen rechts übereinander;
  - `topStack`: ein Bereich oben, die übrigen darunter nebeneinander;
  - `grid`: 2 × 2.
- Ohne Plugin gilt bei 2 Bereichen `columns`, bei 3 `leftStack` und bei 4 `grid`. Hat die Person beim Teilen die Richtung `vertical` gewählt, gilt bei 2 Bereichen `rows`. `orientation` ist diese Richtung.

Details zu den Vorlagen:

- `panes` enthält 2–4 Bereiche der Form `{ table: "schema.tabelle", master?, link? }`.
- `master` ist der Index (ab 0) des Bereichs, dessen ausgewählte Zeile filtert.
- `link: { column, masterColumn? }` filtert den Bereich, wobei `column` im eigenen Bereich und `masterColumn` im Master liegt. Ohne `masterColumn` gilt derselbe Name.
- `orientation` ist `horizontal` (nebeneinander, Standard) oder `vertical` (untereinander).
- `when: { connectionTag?, connectionName? }` zeigt die Vorlage nur passenden Verbindungen. `connectionName` vergleicht den ganzen Namen, `*` ist Platzhalter, und Groß- und Kleinschreibung zählt nicht. Bei einer Liste reicht ein Treffer. Stehen Tag und Name beide da, muss beides passen.

`ctx` in `run` und `props` in `render` enthalten:

- `table` und `columns`, also alle Spalten der geladenen Daten, auch ausgeblendete;
- `selection`: die markierten Zeilen, sonst die aktive Zeile, sonst `[]`;
- `rows`: alle geladenen Zeilen, gefiltert und sortiert. Es bleibt dasselbe Array, bis sich die Daten ändern, und passt deshalb für `useMemo`;
- `options`, `toast(text, tone?)`, `http(url, init?)` und `openTable("schema.tabelle")`.

`run` hat zusätzlich `copy(text)` und `refresh()`. Während `run` läuft, ist der Knopf gesperrt. Wirft `run`, zeigt l8db den Fehler als Meldung und vermerkt ihn in `.status.json`.

`table` = `{ id: "schema.tabelle", schema, name, database, kind, connection: { id, name, kind, environment, tags, readOnly } }`; `readOnly` ist der Schreibschutz der Verbindung. `column` = `{ id, type, label, primaryKey }`. `id` ist der echte Spaltenname, `type` der Typname der Datenbank, z. B. `integer`, `numeric`, `timestamp with time zone`, `character varying`, `jsonb` oder `text[]`. Prüfe ihn mit einem Regex. Postgres liefert `numeric` und `bigint` als Text, JSON als Objekt und Arrays als Array.

## Netzwerk

- `permissions.http` listet höchstens 20 erlaubte Ziele: `host` oder `*.host` (nur Subdomains), optional mit `:port` und einem Pfad, z. B. `"hooks.example.com/hooks"`. Nur `https`, ohne `?` und `#`.
- Ein Pfad gilt als Präfix ab Segmentgrenzen: `/hooks` erlaubt `/hooks` selbst und `/hooks/a`, aber nicht `/hooksx`. Query-Parameter sind immer erlaubt. Bei Zielen mit Pfad lehnt l8db Adressen mit `%2e`, `%2f` oder `%5c` im Pfad ab.
- Die Ziele stehen fest im Code und hängen nicht von Optionen ab. Wähle das engste Ziel; aus Optionen dürfen nur Unterpfade und Query-Parameter kommen.
- Die Person gibt die Ziele in den Einstellungen frei. Ohne Freigabe, bei fremden Zielen oder bei abgeschaltetem Plugin wirft `ctx.http`.
- `ctx.http(url, { method?, headers?, body?, timeoutMs? })`:
  - Methoden: `GET`, `POST`, `PUT`, `PATCH` und `DELETE`.
  - Höchstens 20 Header.
  - `body` ist Text bis 256 KB. Für JSON baust du ihn mit `JSON.stringify` und setzt `Content-Type` selbst.
  - `timeoutMs` ist standardmäßig 15000, höchstens 30000.
- Die Antwort ist `{ ok, status, text(), json() }`. Ein Status außerhalb von 200–299 ergibt `ok: false` und wirft nicht. Netzwerkfehler, Zeitüberschreitung, Weiterleitungen und Antworten mit mehr als 1.048.576 Zeichen werfen.
- Die Anfrage läuft im Fenster von l8db, der Server muss also CORS erlauben.

## Grenzen

- Zeichen:
  - `name`, `author`, Optionslabels: 80;
  - `description`: 500;
  - `version`: 40;
  - Labels von Aktionen, Detail-Tabs und Gruppen: 40, mindestens 1;
  - Vorlagennamen: 60;
  - Optionsbeschreibungen: 300;
  - `id`s von Aktionen, Detail-Tabs und Vorlagen: 40, aus Buchstaben, Ziffern, `_` und `-`.
- Anzahl: höchstens 30 Optionen, 50 Auswahlwerte je `select`, 12 Aktionen, 8 Detail-Tabs, 20 Vorlagen und 20 Netzwerkziele.

Kommt ein Label aus einer Textoption, nimm bei leerem Text einen Standard und kürze auf 40 Zeichen.

## Bausteine

- Komponenten: `Pill`, `Badge`, `Check`, `RelativeTime`, `Text`, `Stack`, `Button`, `Card`, `Columns`, `Bar`, `List` (mit `limit`), `Board` (Kanban, mit `limit` je Spalte) und `Empty`. Die Props stehen in `l8db-ui.d.ts`.
- Töne: `neutral` (grau), `info` (blau), `success` (grün), `warning` (gelb-orange) und `danger` (rot).
- Mehrere Elemente in einer Zelle stehen als Fragment `<>…</>` nebeneinander.

Hilfen:

- `asText`: aus `null` wird `""`, Objekte werden JSON.
- `asNumber`: Zahlen, Zahltexte wie `"12.5"` oder `"1e3"`, `bigint` und Booleans werden Zahlen. `""`, `"12abc"`, `NaN` und `Infinity` ergeben `null`.
- `asDate`: akzeptiert `Date`, Millisekunden und ISO-Texte. Ein reines Datum wie `2026-10-29` gilt als Mitternacht in lokaler Zeit. Was es nicht lesen kann, ergibt `null`.
- `daysFromToday`: Kalendertage in lokaler Zeit, heute ist 0, negativ heißt Vergangenheit.
- `formatNumber(value, { decimals?, currency? })` formatiert deutsch. Was keine Zahl ist, kommt als Text zurück.
- `formatDate(value, { time? })`.

Eigenes JSX mit HTML-Elementen, `style` und Ereignissen wie `onClick` oder `onChange` ist erlaubt; `event.target.value` darfst du lesen. Nimm `style` statt `className`. Für Farben passen die Theme-Variablen `var(--foreground)`, `var(--muted-foreground)`, `var(--border)`, `var(--muted)` und `var(--primary)`. Jede Ausgabe bleibt in ihrer Zelle, ihrem Tab bzw. ihrem Bereich eingeschlossen und kann nichts überdecken.

## Mehrere Plugins

l8db lädt die Dateien nach Dateinamen sortiert. Aus der Galerie installierte Plugins heißen `<id>` mit der Endung der Datei im Katalog, meist `<id>.tsx`.

- Bei `grid.cell`, `grid.rowTone`, `tabs.group`, `tabs.item` und `split.layout` gewinnt die spätere Datei. Liefert sie `undefined`, ist die frühere dran.
- `grid.columns` wird je Spalte und Feld zusammengeführt, die spätere Datei gewinnt. Nicht gesetzte Felder zählen nicht.
- `table.toolbar`, `table.detailTabs` und `split.templates` werden addiert.
- Bei `tabs.options` und `split.options` gewinnt je Feld die spätere Datei. Nicht gesetzte Felder zählen nicht.

## Teilen

Gute Plugins mit Screenshot per Pull Request an https://github.com/Leon-Achteresch/l8db-ui-plugins schicken. Nach dem Merge können alle sie in l8db unter Einstellungen → Erweiterungen → UI-Plugins installieren.
