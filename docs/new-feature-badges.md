# NEW Badges

Neue Funktionen werden in `src/lib/new-features.ts` mit einer stabilen Kennung und ihrer Einführungsversion registriert. Eine Kennung beschreibt zugleich den Navigationsweg, zum Beispiel `settings.data.transfer`. Das Badge erscheint nur, wenn die Einführungsversion exakt der aktuellen App Version aus `package.json` entspricht und die Funktion noch ungesehen ist. Eine spätere Version zeigt alte Badges nicht erneut.

Für eine neue Einstellung:

1. Die Kennung und die aktuelle Version in `NEW_FEATURES` eintragen.
2. Die zugehörige `SettingsRow` mit `featureId="settings.data.transfer"` versehen. Die Zeile zeigt das Badge und meldet die Funktion als gesehen, nachdem mindestens die Hälfte der Zeile drei Sekunden durchgehend im Viewport eines sichtbaren Fensters lag. Wird sie vorher verlassen oder das Fenster verborgen, beginnt die Zeit beim nächsten Sichtkontakt neu.
3. Die Kennung muss den Weg in der Oberfläche abbilden. `settings.data.transfer` markiert automatisch den Settings Button im Header, die Kategorie „Daten & Abfragen“ und einen passenden Suchtreffer. Diese Wegweiser werden selbst nicht als Sichtkontakt gezählt.

Andere Ansichten können `useNewFeatureVisibility<HTMLElement>(featureId)` am tatsächlichen Bedienelement verwenden. Der Hook liefert `ref` und `isNew`; `NewBadge` rendert das Badge. Für übergeordnete Navigation dient `useHasNewFeatures(scope)` oder `hasNewFeatures(scope, useSeenNewFeatures())`, wenn mehrere Einträge in einer Liste dargestellt werden. Nur das tatsächliche Feature erhält den Sichtkontakt Hook.

Der Status liegt pro Funktion und Einführungsversion in `localStorage`. Er bleibt nach einem Neustart erhalten und wird über das `storage` Ereignis zwischen offenen Fenstern synchronisiert. Bei einem erneuten Launch derselben Funktion unter einer anderen Version wird ihre Version in der Registrierung geändert, wodurch das Badge einmal neu erscheint.
