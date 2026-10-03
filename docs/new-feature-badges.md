# NEW Badges

Neue Funktionen werden in `src/lib/new-features.ts` mit einer stabilen Kennung und ihrer Einführungsversion registriert. Eine Kennung beschreibt zugleich den Navigationsweg, zum Beispiel `settings.data.transfer`. Das Badge erscheint nur, wenn die Einführungsversion exakt der aktuellen App Version aus `package.json` entspricht und die Funktion noch ungesehen ist. Eine spätere Version zeigt alte Badges nicht erneut.

Für eine neue Einstellung:

1. Die Kennung und die aktuelle Version in `NEW_FEATURES` eintragen.
2. Die zugehörige `SettingsRow` mit `featureId="settings.data.transfer"` versehen. Die Zeile zeigt das Badge und meldet die Funktion als gesehen, sobald eine der beiden Regeln greift:
   - **Benutzt:** ein Klick auf das Element oder in das Element blendet das Badge sofort aus.
   - **Gesehen:** das Element lag insgesamt zwei Sekunden im Viewport eines sichtbaren Fensters. Die Zeit wird über Unterbrechungen hinweg aufsummiert (Wegscrollen, geschlossenes Menü, verborgenes Fenster) und beginnt erst mit dem nächsten App Start neu. Als sichtbar gilt mindestens die Hälfte des Elements; ist es größer als der Viewport, genügt jeder sichtbare Teil.
3. Die Kennung muss den Weg in der Oberfläche abbilden. `settings.data.transfer` markiert automatisch den Settings Button im Header, die Kategorie „Daten & Abfragen“ und einen passenden Suchtreffer. Diese Wegweiser werden selbst nicht als Sichtkontakt gezählt.

Andere Ansichten können `useNewFeatureVisibility<HTMLElement>(featureId)` am tatsächlichen Bedienelement verwenden. Der Hook liefert `ref` und `isNew`; `NewBadge` rendert das Badge. Für übergeordnete Navigation dient `useHasNewFeatures(scope)` oder `hasNewFeatures(scope, useSeenNewFeatures())`, wenn mehrere Einträge in einer Liste dargestellt werden. Nur das tatsächliche Feature erhält den Sichtkontakt Hook.

Der Status liegt pro Funktion und Einführungsversion in `localStorage`. Er bleibt nach einem Neustart erhalten und wird über das `storage` Ereignis zwischen offenen Fenstern synchronisiert. Bei einem erneuten Launch derselben Funktion unter einer anderen Version wird ihre Version in der Registrierung geändert, wodurch das Badge einmal neu erscheint.
