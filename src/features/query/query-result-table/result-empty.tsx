import { Terminal } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import type { QueryResult } from "@/lib/db";
import { formatHotkeyDisplay, useResolvedHotkey } from "@/lib/hotkeys";

export function ResultEmpty({ result }: { result: QueryResult | null }) {
  const runHotkey = useResolvedHotkey("query.run");
  if (!result) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="max-w-sm text-center">
          <Terminal aria-hidden="true" className="mx-auto mb-3 size-5 text-muted-foreground" />
          <p className="text-sm font-medium">Dein Ergebnis erscheint hier</p>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Schreibe eine Abfrage und führe sie mit <Kbd>{formatHotkeyDisplay(runHotkey)}</Kbd> aus.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <p className="text-sm text-muted-foreground">
        {result.notice
          ? result.notice
          : result.rows_affected !== null && result.rows_affected !== undefined
            ? `${result.rows_affected} Zeile${result.rows_affected === 1 ? "" : "n"} betroffen`
            : "Kein Ergebnis"}
      </p>
    </div>
  );
}
