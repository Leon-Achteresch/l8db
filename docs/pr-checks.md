# Datenbankprüfungen für Pull und Merge Requests

Der Prüfmodus liest eine JSON-Datei und führt ihre Abfragen ohne Desktopfenster aus. Er unterstützt derzeit PostgreSQL. Die Datenbankadresse kommt ausschließlich aus einer Umgebungsvariable; die Datei enthält keine Zugangsdaten. l8db erzwingt für die Verbindung `default_transaction_read_only=on` und ein Statement-Limit von 30 Sekunden, erlaubt pro Prüfung nur ein lesendes `SELECT` oder `WITH` und verwendet für Pläne `EXPLAIN` ohne `ANALYZE`. Der Datenbankbenutzer sollte zusätzlich selbst nur Leserechte besitzen.

## Prüfdatei

```json
{
  "format": 1,
  "checks": [
    {
      "type": "scalar_equals",
      "id": "orders-have-primary-key",
      "sql": "SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.orders'::regclass AND contype = 'p'",
      "expected": 1
    },
    {
      "type": "plan",
      "id": "orders-by-customer",
      "sql": "SELECT id FROM public.orders WHERE customer_id = 42",
      "max_cost": 1000,
      "max_seq_scans": 0,
      "max_index_suggestions": 0
    }
  ]
}
```

`scalar_equals` vergleicht die erste Spalte der ersten Ergebniszeile mit einem JSON-Wert und liest höchstens eine Ergebniszeile. Der Bericht enthält den Wert selbst nicht. `plan` prüft optionale Grenzen für geschätzte Plankosten, Zahl der `Seq Scan`-Knoten und Zahl der Indexkandidaten. Ohne Grenze liefert es einen informativen Planbericht. Planwerte hängen von Datenmenge und Statistiken ab; Grenzwerte auf einer repräsentativen Testdatenbank festlegen. IDs müssen eindeutig sein; höchstens 100 Prüfungen pro Datei.

```sh
L8DB_CHECK_DATABASE_URL='postgresql://reader:...@host/db?sslmode=verify-full' \
  l8db --check --config .l8db/checks.json \
  --url-env L8DB_CHECK_DATABASE_URL --output report.json
```

Die URL sollte als CI-Secret gesetzt werden und nicht im Repository oder Log stehen. Der Bericht auf stdout und in `report.json` enthält Prüf-IDs, Status, aggregierte Planwerte und mögliche Indexvorschläge, aber keine SQL-Abfragen oder Skalarergebnisse. Exitcode `0` bedeutet alle Grenzen eingehalten; `1` bedeutet fehlgeschlagene Prüfung oder Verbindungsfehler; `2` bedeutet ungültige Argumente oder Prüfdatei. Eine fehlende URL oder ungültige Konfiguration erzeugt keinen Bericht.

## GitHub und GitLab

Der Publisher erstellt einen markierten Kommentar am PR/MR und aktualisiert ihn bei späteren Läufen. Er bearbeitet nur einen Kommentar desselben API-Benutzers. Die Prüfung läuft vor dem Publisher; auch bei Exitcode `1` kann der erzeugte Bericht veröffentlicht werden.

```sh
bun run pr:report -- --provider github --repository owner/repo --number 123 \
  --report report.json --token-env GITHUB_TOKEN

bun run pr:report -- --provider gitlab --repository group/project --number 123 \
  --report report.json --token-env L8DB_GITLAB_TOKEN
```

`--api-base` unterstützt GitHub Enterprise und selbst betriebenes GitLab; nur HTTPS und lokales HTTP für Tests sind erlaubt. Der Token wird nicht in den Bericht geschrieben. GitHub benötigt für den PR-Kommentar Schreibrechte auf Issues oder Pull Requests. GitLab benötigt einen Token, der MR-Notizen über die API schreiben darf. [GitHub-Kommentar-API](https://docs.github.com/en/rest/issues/comments), [GitLab-Notizen-API](https://docs.gitlab.com/api/notes/).

Ein CI-Schritt kann beide Befehle nacheinander ausführen und den endgültigen Status vom Publisher übernehmen:

```sh
set +e
l8db --check --config .l8db/checks.json --url-env L8DB_CHECK_DATABASE_URL --output report.json
check_status=$?
set -e
if [ -f report.json ]; then
  bun run pr:report -- --provider github --repository "$GITHUB_REPOSITORY" \
    --number "$PR_NUMBER" --report report.json --token-env GITHUB_TOKEN
else
  exit "$check_status"
fi
```

Für GitLab im letzten Befehl `--provider gitlab --repository "$CI_PROJECT_PATH" --number "$CI_MERGE_REQUEST_IID" --token-env L8DB_GITLAB_TOKEN` verwenden. Die Beispiel-URL muss auf eine dafür eingerichtete, lesende Testdatenbank zeigen. Tests gegen eine produktive Datenbank benötigen eine bewusste Freigabe im jeweiligen CI-Projekt.

## Index-Berater

Der Index-Berater ist auch in der PostgreSQL-Planansicht verfügbar. Er untersucht einfache Gleichheits- oder Bereichsfilter auf sequenziell gelesenen regulären Tabellen, verwendet `pg_class.reltuples` als Tabellenschätzung und prüft die erste Spalte vorhandener B-Tree-Indizes. Nur bei mindestens 10.000 geschätzten Tabellenzeilen und höchstens 10 % geschätzten Ergebniszeilen erscheint ein Vorschlag. Komplexe Ausdrücke und ohne Schemaangabe mehrdeutige Tabellennamen werden ausgelassen. Die vorgeschlagene `CREATE INDEX CONCURRENTLY`-Anweisung wird ausschließlich angezeigt oder kopiert. Datenverteilung, Schreibkosten und reale Laufzeit müssen vor einer Ausführung geprüft werden.
