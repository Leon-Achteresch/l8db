# Feature Discovery

l8db zeigt Nutzern Funktionen, die sie noch nicht kennen, ohne sie bei der Arbeit zu stören. Alles hängt an einem Fundament in `src/lib/discovery/` und einem Host in `src/features/discovery/`.

## Architektur

| Modul | Aufgabe |
|---|---|
| `src/lib/discovery/catalog.ts` (+ `catalog-entries.ts`, `types.ts`) | Katalog aller Funktionen, Bereiche, lokale Suche |
| `src/lib/discovery/usage.ts` | Persistierte Nutzung pro Feature (`l8db.discovery.usage`), Auto-Tracking |
| `src/lib/discovery/events.ts` | Flüchtiger Ereignis-Bus für Verhaltensereignisse |
| `src/lib/discovery/coordinator.ts` | Entscheidet, welche Fläche gerade erscheinen darf |
| `src/lib/discovery/anchors.ts` | `data-feature`-Anker |
| `src/lib/discovery/highlight.ts` + `feature-spotlight-layer.tsx` | Feature in der App hervorheben |
| `src/features/discovery/discovery-host.tsx` + `registry.ts` | Lazy Host nach `backgroundReady`, rendert alle Sub-Hosts |
| `src/features/discovery/discover-tabs.ts` | Tabs der Route `/discover` |
| `src/lib/discovery/channels.ts` | Kanäle und Settings `discovery` |

Der Host lädt erst eine Sekunde nach dem Start (`backgroundReady` in `src/routes/__root.tsx`). Jeder Sub-Host und jeder Tab läuft in eigener `PanelErrorBoundary` und `Suspense`.

## APIs

- `searchFeatures(query, { limit, capabilities, easyMode, areas })`: diakritik- und groß/klein-tolerant, Stoppwörter und Synonyme (z. B. „vergleichen“ ↔ compare/diff), Standardlimit 8.
- `recordFeatureUse(id)`, `featureUsed(id)`, `useFeatureUsage()`, `onFeatureUsed(listener)`. Gespeichert werden Katalog-IDs plus höchstens 256 weitere.
- `recordFeatureEvent(name, data)` / `onFeatureEvent(listener)`: nur Hashes, Längen, Dauer, Flags. Nie SQL-Text oder Werte. Vorhandene Ereignisse: `query.started`, `query.finished`, `query.executed`, `table.opened`, `table.filtered`, `export.done`.
- `requestSurface({ channel, id, priority, explicit })` → `boolean`, danach `releaseSurface(channel, id)`. `useActiveSurface()` liefert die sichtbare Fläche.
- `highlightFeature(id, { signal })` navigiert zur Route, wartet höchstens 4 s auf den Anker und legt einen Ring darüber.
- `resetDiscoveryProgress()` löscht alle `l8db.discovery.*`-Schlüssel; Stores melden sich mit `onDiscoveryReset(listener)` an.

## Feature eintragen

1. Eintrag in `src/lib/discovery/catalog-entries.ts` im passenden Bereich (`FEATURE_AREAS`). Pflicht: `id`, `title`, `summary`, `area`, `keywords` (deutsch, mit Synonymen). Optional `route`, `hotkey` (ID aus `src/lib/hotkeys/commands-*.ts`), `videoId` (aus `scripts/feature-videos/catalog.json`), `related`, `since`, `size: "major"`, `capability`, `hiddenInEasyMode`, `steps`.
2. Am echten Bedienelement `data-feature="<id>"` setzen (oder `{...featureAnchor(id)}`). Ohne `anchor` gilt die ID als Anker.
3. Der erste Eintrag mit einer bestimmten `route` gilt beim Aufruf dieser Route als genutzt.
4. `tests/discovery-foundation.test.ts` prüft IDs, Verweise, Routen, Hotkeys, Videos und Anker.

## Kanäle

`promoter`, `waitTips`, `hotspots`, `spotlight`, `welcomeBack`, `feedback`, `related`, `teamTips`, `recap`, `achievements`, `videoTooltips`. Alle sind standardmäßig an, `achievements` ist aus. Schalter liegen unter Einstellungen → Entdecken (`settings.discovery`); weitere Zeilen kommen über `DISCOVERY_SETTINGS_SLOTS`.

## Ruhe-Regeln

Automatische Flächen erscheinen nur, wenn

- `discovery.enabled` und der Kanal an sind,
- keine andere Discovery-Fläche, kein Shortcut-Hinweis, kein Feature-Video und kein Blog-Vorschlag sichtbar ist,
- seit der letzten automatischen Fläche 4 Minuten vergangen sind und in dieser Sitzung weniger als 6 erschienen sind,
- `isQuiet` aus `src/lib/blog-suggestions/quiet.ts` gilt (keine Eingabe, kein Dialog, kein Onboarding, keine Tour, keine laufende Aufgabe oder offene Transaktion, keine dringende Meldung).

Eine wichtigere automatische Fläche (höhere `priority`) verdrängt eine weniger wichtige. Explizit geöffnete Flächen (`explicit: true`, nach Klick oder Shortcut) umgehen Kanal, Ruhe-Gate und Cooldown.

## Guide „Zeig's mir“

Import aus `@/lib/discovery/guide`. Der Host `src/features/discovery/guide/guide-host.tsx` (Registry-ID `guide`) setzt den Navigator, meldet Routenwechsel und rendert Ring, Geister-Cursor und Sprechblase.

- `startGuide(featureId, options?) → boolean`: startet die `steps` des Katalogeintrags (oder `options.steps`). `false`, wenn es keine Schritte gibt. Ein laufender Guide endet mit `replaced`; ein offenes Highlight wird geschlossen. Belegt die Fläche `spotlight` mit `guide:<featureId>` (explizit).
- `stopGuide()`: beendet sofort (`stopped`), entfernt Listener, Timer und Observer.
- `nextGuideStep()`: entspricht „Weiter“, nach dem letzten Schritt `done`.
- `useGuide()` → `GuideView | null` (`featureId`, `title`, `steps`, `index`, `element`, `phase: "seeking" | "pointing" | "waiting"`, `autoClick`, `manual`), `isGuideRunning()`, `guideHasSteps(id)`.
- `options`: `steps`, `title`, `advanceOnClick` (Standard `true`; `false` blendet „Weiter“ aus, der Aufrufer schaltet weiter), `allowNavigation` (Routenwechsel durch den Nutzer beendet nicht), `timeoutMs` (Anker-Wartezeit, Standard 4 s), `onEnd(reason)` mit `done | stopped | escape | navigation | missing | replaced`.

Ablauf pro Schritt: `route` ansteuern, `waitForAnchor(anchor)`, Cursor fährt hin (bei reduzierter Bewegung Sprung), Ring und Text. Ein leerer `anchor` zeigt nur die Sprechblase. Automatisch geklickt wird nur, wenn `safeClick` gesetzt ist, die aktive Verbindung nicht `isProduction` ist und der Anker ein Link, Tab oder Navigationselement ist (`canAutoClick`); sonst wartet der Guide, bis der Nutzer den Anker klickt. Escape, Routenwechsel durch den Nutzer außerhalb der Schritte und ein fehlender Anker beenden mit Toast.

## Atlas, Lektionen, KI-Feature-Suche

- Atlas (`src/lib/discovery/atlas/`, Tab `atlas`): Prozent zählt nur Features, die für die aktive Verbindung und den Easy Mode verfügbar sind. „Neu“ sind die sechs neuesten `since`-Einträge.
- Lektionen (`src/lib/discovery/lessons/`, Tab `lessons`, Host `lessons`): Schritte prüfen `{ feature }` gegen `onFeatureUsed` oder `{ event, where }` gegen `onFeatureEvent`, nur solange die Demo-Verbindung aktiv ist. „Lektion starten“ erzeugt `l8db-lernen-shop.sqlite` im Temp-Verzeichnis (`customers`, `products`, `orders`, `order_items`, 50–500 Zeilen, bei jedem Start neu befüllt) als temporäre Verbindung, die nie gespeichert wird; „Lektion beenden“ entfernt die Verbindung und aktiviert die vorherige; die Datei bleibt liegen und wird beim nächsten Start wiederverwendet. Fortschritt liegt in `l8db.discovery.lessons`.
- KI-Chat: Bei Wie-/Wo-Fragen hängt `activeFeatureContext` (`src/lib/ai/feature-search.ts`) höchstens fünf Treffer aus `searchFeatures` an (≤ 2 KB). Antwortet das Modell mit einem ```` ```feature ```` -Block, zeigt der Chat Karten mit „Zeigen“ und „Zeig's mir“.

## Labs, Roadmap, Team-Tipps, Rückblick, Erfolge

- Labs (`src/lib/discovery/labs/labs.ts`): `LABS` mit `{ id, title, summary, featureId?, mirror? }`, `useLab(id)`, `setLab(id, on)`. Schalter mit `mirror` spiegeln eine vorhandene Einstellung (Canary-Updates → `updateChannel`, Erfolge → Kanal `achievements`), alle anderen landen in `settings.discovery.labs`. Neue Labs nur für Funktionen, die wirklich existieren. Jeder Eintrag hat „Feedback“ (vorbefülltes GitHub-Issue im Browser).
- Erfolge (`src/lib/discovery/achievements/`): deklarative Regeln über Feature-Nutzung, Ereignis-Zähler und Datenbank-Familien. Beim ersten Einschalten werden alle bereits erfüllten Erfolge still freigeschaltet und als eine Karte zusammengefasst.
- Rückblick (`src/lib/discovery/recap/`): nur lokale Daten (Nutzungsstatistik, Feature-Nutzung, Aktivität pro Tag, höchstens 400 Tage). Angebot vom 1.12. bis 15.1. einmal pro Jahr. „Als Bild speichern“ zeichnet lokal per Canvas.
- Team-Tipps: siehe [team-hub.md](team-hub.md#team-tipps).

### Roadmap-Feed

Der Tab „Roadmap“ lädt erst beim Öffnen den Body des GitHub-Pre-Release mit Tag `roadmap` in `Leon-Achteresch/l8db` (öffentliche API ohne Token, Timeout 8 s, höchstens alle 6 h, manuell höchstens 1×/min, Cache 48 h, Antwort höchstens 400 KB). Format (Body als JSON, optional in einem ```` ```json ````-Block):

```json
{ "schemaVersion": 1,
  "items": [
    { "id": "oracle-plaene", "title": "Pläne für Oracle", "summary": "EXPLAIN PLAN direkt im Editor.", "status": "in-arbeit", "issue": 123, "votes": 14, "eta": "Q1 2027" }
  ] }
```

- `id`: `a-z 0-9 -`, höchstens 64 Zeichen, eindeutig. `title` ≤ 80, `summary` ≤ 400 Zeichen, `status`: `geplant` | `in-arbeit` | `erschienen`. Optional `issue` (Nummer, ergibt „Abstimmen“), `votes`, `eta` (≤ 32 Zeichen).
- Ungültige Einträge werden verworfen, mehr als 1000 Einträge oder eine andere `schemaVersion` verwerfen den ganzen Feed; angezeigt werden höchstens 100.
- Veröffentlichen: Pre-Release mit Tag `roadmap` anlegen oder dessen Beschreibung bearbeiten, z. B. `gh release edit roadmap --notes-file roadmap.json`. Der Tag darf kein Versions-Tag sein und wird nie „Latest“.
