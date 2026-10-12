import { CheckCircle2 } from "lucide-react";
import type { ExternalImportSummary as Summary } from "@/lib/connection-import";

interface Props {
  summary: Summary;
  keychainFailures: number;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function ExternalImportSummary({ summary, keychainFailures }: Props) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-md border px-3 py-3 text-sm">
      <p className="flex items-center gap-2 font-medium">
        <CheckCircle2 className="size-4 text-emerald-600 dark:text-emerald-400" />
        Import abgeschlossen
      </p>
      <ul className="grid gap-1 text-xs text-muted-foreground">
        <li>{plural(summary.imported, "Verbindung importiert", "Verbindungen importiert")}</li>
        <li>{plural(summary.skipped, "Eintrag übersprungen", "Einträge übersprungen")}</li>
        <li>
          {plural(
            summary.missingPassword,
            "Verbindung ohne Passwort",
            "Verbindungen ohne Passwort",
          )}
          {summary.missingPassword > 0 ? ", bitte im Profil ergänzen" : ""}
        </li>
        {keychainFailures > 0 && (
          <li className="text-amber-600 dark:text-amber-400">
            {keychainFailures === 1 ? "1 Geheimnis gilt" : `${keychainFailures} Geheimnisse gelten`}{" "}
            nur in dieser Sitzung: Schlüsselbund nicht verfügbar.
          </li>
        )}
      </ul>
    </div>
  );
}
