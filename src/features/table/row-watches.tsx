import { EyeIcon, XIcon } from "lucide-react";
import { useContext, useState } from "react";
import { toast } from "sonner";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { deleteWorkbenchRecord, saveWorkbenchRecord } from "@/lib/workbench/records";
import { RowWatchContext } from "@/lib/workbench/row-watch-context";
import {
  displayCurrentWatchedCell,
  displayWatchedCell,
  watchSnapshot,
} from "@/lib/workbench/row-watches";

export function RowWatches({ scope }: { scope: string }) {
  const [busy, setBusy] = useState(false);
  const { records, states, loading, error, open, setOpen } = useContext(RowWatchContext);
  const changedRows = states.filter((state) => state.changed.length > 0).length;
  const unloaded = states.filter((state) => !state.row).length;
  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.error(String(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onOpenChange={setOpen} modal={false}>
      <SheetContent
        className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-md"
        aria-label="Beobachtete Zeilen"
        showCloseButton={false}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <SheetClose asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-4 top-4"
            aria-label="Beobachtete Zeilen schließen"
          >
            <XIcon />
          </Button>
        </SheetClose>
        <SheetHeader className="gap-2 border-b p-5 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <EyeIcon className="size-4 text-muted-foreground" />
            Beobachtete Zeilen
          </SheetTitle>
          <SheetDescription className="text-xs leading-relaxed">
            Gespeicherte Werte mit den aktuell geladenen Zeilen vergleichen.
          </SheetDescription>
        </SheetHeader>
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 border-b bg-muted/30 px-5 py-3 text-xs tabular-nums"
          role="status"
        >
          <span>
            <strong className="font-semibold">{records.length}</strong> beobachtet
          </span>
          <span className={changedRows ? "text-primary" : "text-muted-foreground"}>
            {changedRows} geändert
          </span>
          {unloaded > 0 && <span className="text-muted-foreground">{unloaded} nicht geladen</span>}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          {loading && (
            <p className="py-6 text-xs text-muted-foreground" role="status">
              Beobachtungen werden geladen…
            </p>
          )}
          {error && (
            <p role="alert" className="py-6 text-xs text-destructive">
              {error}
            </p>
          )}
          {!loading && !error && !records.length && (
            <div className="space-y-2 py-10">
              <p className="text-sm font-medium">Wichtige Zeilen im Blick behalten</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Rechtsklick auf eine Tabellenzeile → „Datensatz beobachten“. Nach dem nächsten Laden
                siehst du hier, welche Werte sich geändert haben.
              </p>
            </div>
          )}
          <Accordion
            type="single"
            collapsible
            defaultValue={
              states.find((state) => state.changed.length)?.watch.id ?? states[0]?.watch.id
            }
          >
            {states.map(({ watch, row, changed }) => (
              <AccordionItem key={watch.id} value={watch.id}>
                <AccordionTrigger className="items-center gap-3 py-4 hover:no-underline">
                  <span className="min-w-0 space-y-1 text-left">
                    <span className="block break-all font-mono text-xs font-medium">
                      {watch.name}
                    </span>
                    <span
                      className={`block text-xs font-normal ${changed.length ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {!row
                        ? "Nicht geladen"
                        : changed.length
                          ? `${changed.length} Werte geändert`
                          : "Geladene Werte unverändert"}
                    </span>
                  </span>
                </AccordionTrigger>
                <AccordionContent className="space-y-4 pb-4">
                  {changed.length > 0 && (
                    <div className="overflow-hidden rounded-lg border text-xs">
                      <div className="grid grid-cols-2 gap-3 bg-muted/40 px-3 py-2 text-muted-foreground">
                        <span>Gespeicherter Stand</span>
                        <span>Aktuell geladen</span>
                      </div>
                      {changed.map((column) => (
                        <div key={column} className="border-t px-3 py-3">
                          <p className="mb-2 break-all font-mono font-medium">{column}</p>
                          <div className="grid grid-cols-2 gap-3 font-mono leading-relaxed">
                            <span className="min-w-0 break-all text-muted-foreground">
                              {displayWatchedCell(watch.value.cells[column])}
                            </span>
                            <span className="min-w-0 break-all text-primary">
                              {displayCurrentWatchedCell(row?.[column])}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {!row && (
                    <p className="text-xs text-muted-foreground">
                      Diese Zeile ist aktuell nicht geladen. Das bedeutet nicht, dass sie gelöscht
                      wurde.
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || !row}
                      onClick={() =>
                        void act(async () =>
                          saveWorkbenchRecord({
                            id: watch.id,
                            kind: "watch",
                            scope,
                            name: watch.name,
                            value: {
                              ...watch.value,
                              cells: {
                                ...watch.value.cells,
                                ...watchSnapshot(
                                  row ?? {},
                                  watch.value.keys,
                                  Object.keys(watch.value.cells),
                                ).cells,
                              },
                            },
                          }),
                        )
                      }
                    >
                      Stand übernehmen
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Beobachtung ${watch.name} entfernen`}
                      onClick={() => void act(() => deleteWorkbenchRecord(watch.id))}
                    >
                      Entfernen
                    </Button>
                  </div>
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
        <p className="border-t px-5 py-4 text-xs leading-relaxed text-muted-foreground">
          Nur geladene Daten · Keine automatischen Abfragen
        </p>
      </SheetContent>
    </Sheet>
  );
}
