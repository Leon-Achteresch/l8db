# Blog-Vorschläge

Die App schlägt ab und zu unten rechts einen Artikel aus dem Blog der Website vor. Gesteuert wird das ausschließlich über das Website-Repo: Ein Post mit `suggest: true` im Frontmatter erscheint im Feed mit einem `suggest`-Objekt.

## Feed

`websiteUrl("/blog/feed.json")` (`src/lib/website.ts`), also `https://l8db.leon-achteresch.de/blog/feed.json` bzw. `http://localhost:3000/blog/feed.json` im Dev-Modus.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-10-24T08:00:00Z",
  "items": [
    {
      "slug": "ruhige-abfragen",
      "url": "https://l8db.leon-achteresch.de/blog/ruhige-abfragen",
      "title": "…",
      "summary": "…",
      "publishedAt": "2026-10-20",
      "readingMinutes": 5,
      "image": "https://l8db.leon-achteresch.de/blog/ruhige-abfragen/cover.png",
      "imageAlt": "…",
      "tags": ["sql"],
      "suggest": { "until": "2026-11-30", "priority": 10, "minAppVersion": null }
    }
  ]
}
```

- Die Website muss `Access-Control-Allow-Origin: *` für `feed.json` senden, sonst blockiert der WebView den Abruf. Ein `ETag` genügt für die Revalidierung; die App fragt mit `cache: "no-cache"` an.
- Strukturfehler (anderes `schemaVersion`, mehr als 20 Items, kein JSON, mehr als 256 KB) verwerfen den ganzen Feed. Ungültige Items werden einzeln übersprungen.
- `url` muss exakt auf der Website-Origin liegen und mit `/blog/` beginnen. `image` muss https sein und auf derselben Origin liegen (Dev: `http://localhost:3000` erlaubt). Texte werden nie als HTML interpretiert; Steuer- und Bidi-Zeichen machen ein Item ungültig.
- Grenzen: `slug` ≤ 120 (`a-z0-9-`), `title` ≤ 140, `summary` ≤ 320, `imageAlt` ≤ 240, `readingMinutes` 1–240, höchstens 20 Tags à 40 Zeichen.
- Auswahl: `suggest` gesetzt, `until` heute oder später (lokales Datum), `publishedAt` nicht in der Zukunft, `minAppVersion` erfüllt (Canary `X.Y.Z-canary.N` zählt als `X.Y.Z`). Sortiert nach `priority`, dann `publishedAt`, dann `slug`.

## Verhalten

- Abruf höchstens alle 12 Stunden (Zeitstempel in `l8db.blog-suggestions`), nur wenn die Einstellung „Blog-Vorschläge“ an ist, das Gerät online ist und keine Karte in den letzten drei Tagen erschien. Ausgelöst beim Start und bei Fensterfokus, nie per Intervall.
- Eine Karte erscheint nur, wenn das Fenster sichtbar und fokussiert ist, die App seit mindestens 5 Minuten läuft, seit 30 Sekunden keine Eingabe kam (2 Minuten bei fokussiertem Eingabefeld oder Editor), keine Aufgabe oder Abfrage läuft, keine Transaktion offen ist, kein Dialog, Menü oder Popover offen ist, Onboarding und Tour abgeschlossen sind, keine Fehler- oder Warnmeldung steht und kein Feature-Video läuft. Geprüft wird alle 5 Sekunden, aber nur solange ein Vorschlag fällig ist.
- Höchstens eine Karte alle drei Tage, jeder Post nur einmal. Schließen (X/Esc), „Lesen“ und automatisches Ausblenden nach 30 Sekunden sichtbarer Zeit (pausiert bei Hover und Fokus) zählen alle als gesehen. Feature-Videos haben Vorrang und schließen eine offene Blog-Karte.
- Verlauf und letzte Anzeige werden über `syncAcrossWindows` zwischen Fenstern geteilt; nur das fokussierte Fenster zeigt eine Karte.

Code: `src/lib/blog-suggestions/`, `src/features/updates/blog-suggestion-*.tsx`, Tests in `tests/blog-suggestions.test.ts` und `tests/perf-blog-suggestions.test.ts`.
