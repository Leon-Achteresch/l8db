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
