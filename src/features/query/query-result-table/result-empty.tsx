import { Cobweb } from "@/components/seasonal/cobweb";
import type { QueryResult } from "@/lib/db";

export function ResultEmpty({ result }: { result: QueryResult | null }) {
  if (!result) {
    return (
      <div className="relative flex h-full items-center justify-center bg-card/30">
        <Cobweb className="size-20 text-foreground/20" />
        <p className="text-sm text-muted-foreground">
          Drücke{" "}
          <kbd className="rounded-full border bg-muted px-2 py-0.5 font-mono text-xs">⌘ Enter</kbd>{" "}
          um die Abfrage auszuführen.
        </p>
      </div>
    );
  }
  return (
    <div className="relative flex h-full items-center justify-center bg-card/30">
      <Cobweb className="size-20 text-foreground/20" />
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
