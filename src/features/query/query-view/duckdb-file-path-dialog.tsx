import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DuckdbFilePathContext } from "@/lib/db/duckdb-path-context";

export type DuckdbPathHelp = DuckdbFilePathContext | { state: "transaction" };

const statusText = {
  no_session: "Für diese Verbindung ist noch keine DuckDB-Sitzung geöffnet.",
  busy: "Die DuckDB-Sitzung ist gerade beschäftigt.",
  unknown: "Der Pfadkontext dieser Sitzung konnte nicht ermittelt werden.",
  transaction:
    "Die verwaltete Transaktion nutzt eine eigene Sitzung. Ihre Pfadbasis ist hier nicht ermittelt.",
};

export function DuckdbFilePathDialog({
  request,
  onClose,
  onRestoreFocus,
}: {
  request: Promise<DuckdbPathHelp>;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const [result, setResult] = useState<DuckdbPathHelp>();
  useEffect(() => {
    let listening = true;
    void request.then((context) => {
      if (listening) setResult(context);
    });
    return () => {
      listening = false;
    };
  }, [request]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-auto p-5 sm:max-w-md"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Relative Dateipfade in DuckDB</DialogTitle>
          <DialogDescription>
            Momentaufnahme zur Pfadbasis lokaler Eingabedateien.
          </DialogDescription>
        </DialogHeader>
        {result?.state === "snapshot" ? (
          <dl className="grid min-w-0 gap-2">
            <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="font-mono text-xs font-medium">file_search_path</dt>
              <dd className="mt-1 wrap-anywhere">
                {result.file_search_path === "" ? (
                  <span className="text-xs text-muted-foreground">
                    Leer · DuckDB nutzt das Arbeitsverzeichnis
                  </span>
                ) : (
                  <code className="text-xs whitespace-pre-wrap">
                    {result.file_search_path ?? "Unbekannt"}
                  </code>
                )}
              </dd>
            </div>
            <div className="min-w-0 rounded-lg bg-muted/40 px-3 py-2">
              <dt className="text-xs font-medium">Arbeitsverzeichnis des DuckDB-Prozesses</dt>
              <dd className="mt-1 wrap-anywhere">
                <code className="text-xs">{result.working_directory ?? "Unbekannt"}</code>
              </dd>
            </div>
          </dl>
        ) : (
          <p role="status" className="text-xs leading-relaxed text-muted-foreground">
            {result ? statusText[result.state] : "Sitzungskontext wird gelesen…"}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="secondary">
              Schließen
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
