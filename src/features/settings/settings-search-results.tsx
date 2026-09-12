import { ArrowRight, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SearchItem {
  id: string;
  tabId: string;
  tabLabel: string;
  title: string;
  description: string;
  keywords: string[];
}

const SEARCH_ITEMS: SearchItem[] = [
  {
    id: "filter-operators",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "Filteroperatoren übersetzen",
    description:
      "Verständliche Bezeichnungen oder SQL-Syntax und native Datenbankoperatoren anzeigen.",
    keywords: [
      "filter",
      "operatoren",
      "übersetzen",
      "sql",
      "gleich",
      "like",
      "in",
      "not in",
      "null",
    ],
  },
  {
    id: "table-tabs",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Tabbar für Tabellen & Views",
    description: "Sichtbare Tabs global oder per Kontextmenü anpassen.",
    keywords: [
      "tabs",
      "tabbar",
      "sichtbar",
      "ausblenden",
      "einblenden",
      "kontextmenü",
      "daten",
      "columns",
      "trigger",
      "indexes",
      "rls",
      "partitionen",
      "used by",
      "performance",
      "audit",
      "definition",
    ],
  },
  {
    id: "theme",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Erscheinungsbild",
    description: "Hell, dunkel oder dem System folgen.",
    keywords: ["theme", "dark", "light", "system", "farbe", "modus", "hell", "dunkel"],
  },
  {
    id: "ui-scale",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Oberflächengröße",
    description:
      "Schrift, Symbole und Bedienelemente in der gesamten App von 80 bis 150 % skalieren.",
    keywords: [
      "größe",
      "grösse",
      "zoom",
      "skalierung",
      "kleiner",
      "größer",
      "schrift",
      "lesbarkeit",
      "oberfläche",
    ],
  },
  {
    id: "sidebar-extra-compact",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Seitenleiste extra kompakt",
    description: "Noch dichtere Objektlisten mit 20 px Zeilenhöhe und ohne Zwischenräume.",
    keywords: ["sidebar", "seitenleiste", "dichter", "kompakt", "abstände", "zeilenhöhe"],
  },
  {
    id: "density",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "UI-Dichte",
    description: "Abstände von Tabellen, Listen und Steuerelementen optimieren.",
    keywords: [
      "dichte",
      "abstand",
      "kompakt",
      "spacious",
      "layout",
      "kompaktheit",
      "zeilenhöhe",
      "seitenleiste",
    ],
  },
  {
    id: "tour",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Produkttour",
    description: "Kapitelweise Führung durch Verbindungen, Explorer, SQL und Einstellungen.",
    keywords: ["tour", "anleitung", "hilfe", "einführung", "walkthrough", "tutorial"],
  },
  {
    id: "reset",
    tabId: "general",
    tabLabel: "Allgemein",
    title: "Werkseinstellungen",
    description: "Alle Optionen auf die ursprünglichen Standardwerte zurücksetzen.",
    keywords: ["reset", "werkseinstellungen", "standard", "löschen", "zurücksetzen"],
  },
  {
    id: "font-size",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "Schriftgröße",
    description: "Größe der Code-Schriftart im Abfrage-Editor (10 bis 24 px).",
    keywords: ["font", "schrift", "größe", "fontsize", "textgröße", "editor"],
  },
  {
    id: "tab-size",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "Einrückungsbreite",
    description: "Anzahl der Leerzeichen pro Tabulatorstufe (2 oder 4).",
    keywords: ["tab", "einrückung", "indent", "spaces", "leerzeichen"],
  },
  {
    id: "keyword-case",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "SQL-Keywords",
    description: "Automatische Groß- oder Kleinschreibung beim Formatieren.",
    keywords: ["keywords", "groß", "klein", "upper", "lower", "schreibweise", "format"],
  },
  {
    id: "word-wrap",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "Automatischer Zeilenumbruch",
    description: "Lange SQL-Zeilen im Editor automatisch umbrechen.",
    keywords: ["wrap", "umbruch", "zeilenumbruch", "wordwrap"],
  },
  {
    id: "line-numbers",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "Zeilennummern",
    description: "Nummerierung am linken Rand des Editors anzeigen.",
    keywords: ["zeilen", "nummern", "linenumbers", "zeilennummerierung"],
  },
  {
    id: "minimap",
    tabId: "editor",
    tabLabel: "SQL-Editor",
    title: "Code-Minimap",
    description: "Verkleinerte Übersicht des gesamten SQL-Skripts am rechten Rand.",
    keywords: ["minimap", "übersicht", "karte", "scroll"],
  },
  {
    id: "row-limit",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "Standard-Zeilenlimit",
    description: "Maximale Anzahl abgerufener Datensätze pro Tabelle (10 bis 5000).",
    keywords: ["limit", "zeilen", "records", "datensätze", "rows", "tabelle"],
  },
  {
    id: "timeout",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "Query-Timeout",
    description: "Maximale Ausführungszeit für Abfragen vor Abbruch.",
    keywords: ["timeout", "zeit", "abfrage", "dauer", "abbruch", "sekunden"],
  },
  {
    id: "transactions",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "Änderungen als Transaktion",
    description: "Zeilenänderungen und DML sammeln und erst nach manuellem Commit persistieren.",
    keywords: ["transaktion", "transaction", "commit", "rollback", "safe", "sicher"],
  },
  {
    id: "destructive-confirm",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "Destruktive Abfragen absichern",
    description: "Bestätigungsdialog vor DROP TABLE, TRUNCATE oder DELETE.",
    keywords: ["drop", "truncate", "delete", "warnung", "sicherheit", "bestätigung"],
  },
  {
    id: "null-values",
    tabId: "data",
    tabLabel: "Daten & Abfragen",
    title: "NULL-Werte hervorheben",
    description: "NULL-Werte im Tabellengitter optisch klar von leeren Zeichenketten trennen.",
    keywords: ["null", "hervorheben", "darstellung", "gitter", "tabelle", "leer"],
  },
  {
    id: "ssh-tofu",
    tabId: "security",
    tabLabel: "Sicherheit & SSH",
    title: "Neue SSH-Host-Keys akzeptieren",
    description: "Unbekannte Server-Schlüssel beim ersten Verbindungsaufbau automatisch speichern.",
    keywords: ["ssh", "host", "keys", "fingerprint", "tofu", "trust"],
  },
  {
    id: "conn-timeout",
    tabId: "security",
    tabLabel: "Sicherheit & SSH",
    title: "Verbindungs-Timeout",
    description: "Maximale Wartezeit beim Verbindungsaufbau zur Datenbank.",
    keywords: ["verbindung", "timeout", "netzwerk", "connect"],
  },
  {
    id: "ssl-mode",
    tabId: "security",
    tabLabel: "Sicherheit & SSH",
    title: "Standard-SSL-Modus",
    description: "Standardmäßige TLS/SSL-Anforderung für neue Datenbankverbindungen.",
    keywords: ["ssl", "tls", "zertifikat", "verschlüsselung", "prefer", "require"],
  },
  {
    id: "keychain",
    tabId: "security",
    tabLabel: "Sicherheit & SSH",
    title: "OS-Schlüsselbund & Secrets",
    description: "Passwörter und SSH-Schlüssel werden über die native Keychain verwaltet.",
    keywords: ["keychain", "schlüsselbund", "passwort", "tresor", "geheimnis", "vault"],
  },
  {
    id: "extensions",
    tabId: "extensions",
    tabLabel: "Erweiterungen",
    title: "Community Extensions",
    description: "Installiere ein Paket oder lade einen lokalen Entwicklungsordner.",
    keywords: ["extension", "plugin", "erweiterung", "community", "paket", "installieren"],
  },
  {
    id: "updates",
    tabId: "about",
    tabLabel: "Über & Updates",
    title: "Automatische Updates",
    description: "Beim Start im Hintergrund nach neuen Versionen suchen.",
    keywords: ["update", "version", "upgrade", "aktualisierung", "neu"],
  },
  {
    id: "release-notes",
    tabId: "about",
    tabLabel: "Über & Updates",
    title: "Release Notes",
    description: "Änderungen aller bisherigen Versionen ansehen.",
    keywords: ["release", "notes", "changelog", "änderungen", "versionen"],
  },
  {
    id: "diagnostics",
    tabId: "about",
    tabLabel: "Über & Updates",
    title: "Systemdiagnose",
    description:
      "Laufzeitumgebung und Debug-Informationen für Support oder Fehlerberichte kopieren.",
    keywords: ["diagnose", "system", "info", "kopieren", "fehlerbericht", "support"],
  },
  {
    id: "bug-report",
    tabId: "about",
    tabLabel: "Über & Updates",
    title: "Bug melden",
    description: "Problem beschreiben und auf GitHub melden, kopieren oder per E-Mail senden.",
    keywords: ["bug", "fehler", "melden", "report", "github", "issue", "email", "mail", "support"],
  },
];

interface SettingsSearchResultsProps {
  query: string;
  onSelectTab: (tabId: string) => void;
  onClearQuery: () => void;
}

export function SettingsSearchResults({
  query,
  onSelectTab,
  onClearQuery,
}: SettingsSearchResultsProps) {
  const normalized = query.trim().toLowerCase();

  const results = SEARCH_ITEMS.filter((item) => {
    return (
      item.title.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized) ||
      item.keywords.some((k) => k.toLowerCase().includes(normalized))
    );
  });

  if (results.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 p-8 text-center">
        <SearchX className="size-8 text-muted-foreground/60" />
        <p className="mt-3 text-sm font-medium">Keine Einstellungen gefunden</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Keine Treffer für &ldquo;{query}&rdquo;. Probiere einen anderen Suchbegriff.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={onClearQuery}>
          Suche zurücksetzen
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {results.length} {results.length === 1 ? "Treffer" : "Treffer"} für &ldquo;{query}&rdquo;
        </p>
        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={onClearQuery}>
          Zurück zur Kategorie
        </Button>
      </div>

      <div className="space-y-2">
        {results.map((result) => (
          <div
            key={result.id}
            className="flex items-center justify-between gap-4 rounded-xl border border-border/80 bg-card p-3 shadow-xs hover:border-primary/40 transition-colors"
          >
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold">{result.title}</span>
                <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {result.tabLabel}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">{result.description}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 text-xs"
              onClick={() => {
                onSelectTab(result.tabId);
                onClearQuery();
              }}
            >
              <span>Öffnen</span>
              <ArrowRight className="size-3" />
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
