import { useNavigate } from "@tanstack/react-router";
import { FolderClock } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useActiveConnection, useConnectionsStore } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { navigateToTab } from "@/lib/tab-navigation";
import { tabKey } from "@/lib/table-tabs";
import { useActiveWorkspaceTab } from "@/lib/use-active-workspace-tab";
import {
  captureInvestigation,
  type Investigation,
  restoreInvestigation,
  saveInvestigation,
} from "@/lib/workbench/investigations";
import { deleteWorkbenchRecord, workbenchScope } from "@/lib/workbench/records";
import { useWorkbenchRecords } from "@/lib/workbench/use-records";

export function InvestigationsDialogButton() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const activeTab = useActiveWorkspaceTab();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const scope = workbenchScope(connection?.id ?? "", database);
  const { records, loading, error } = useWorkbenchRecords<Investigation>(
    "investigation",
    scope,
    open && Boolean(connection),
  );
  const feature = useNewFeatureVisibility<HTMLButtonElement>("workspace.investigations");
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
  const reset = () => {
    setName("");
    setNote("");
    setSelected(undefined);
  };
  return (
    <>
      <Button
        ref={feature.ref}
        size="icon-sm"
        variant="ghost"
        className="relative shrink-0"
        aria-label="Arbeitsstände"
        title="Arbeitsstände mit Notizen"
        disabled={!connection}
        onClick={() => {
          reset();
          setOpen(true);
        }}
      >
        <FolderClock className="size-3.5" />
        {feature.isNew && <NewBadge className="absolute -top-1" />}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90dvh] overflow-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Arbeitsstände</DialogTitle>
            <DialogDescription>
              Abfragen, Tabellen, Filter und Editor-Anordnung für {connection?.name} /{" "}
              {database ?? "Standard"} sammeln. Öffnen ergänzt deine Tabs; SQL wird nicht
              ausgeführt. Gespeicherte Tabellenfilter werden wiederhergestellt.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Name des Arbeitsstands"
            placeholder="Zum Beispiel: Bestellung 4711 untersuchen"
            value={name}
            maxLength={80}
            onChange={(event) => setName(event.target.value)}
          />
          <Textarea
            aria-label="Notiz zum Arbeitsstand"
            placeholder="Was hast du herausgefunden? Was ist noch offen?"
            value={note}
            maxLength={10_000}
            onChange={(event) => setNote(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={busy || !name.trim() || !connection}
              onClick={() =>
                void act(async () => {
                  if (!connection) return;
                  await saveInvestigation(
                    scope,
                    name,
                    captureInvestigation(
                      connection.id,
                      database,
                      activeTab ? tabKey(activeTab) : null,
                      note,
                    ),
                    records.some((entry) => entry.id === selected) ? selected : undefined,
                  );
                  reset();
                  toast.success("Arbeitsstand gespeichert");
                })
              }
            >
              {selected ? "Mit aktuellen Tabs aktualisieren" : "Aktuelle Tabs speichern"}
            </Button>
            {selected && (
              <Button size="sm" variant="outline" onClick={reset}>
                Neuer Arbeitsstand
              </Button>
            )}
          </div>
          {loading && (
            <p role="status" className="text-sm">
              Arbeitsstände werden geladen…
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {!loading && !records.length && (
            <p className="py-4 text-sm text-muted-foreground">
              Noch keine Arbeitsstände für diese Datenbank.
            </p>
          )}
          <div className="max-h-80 space-y-3 overflow-auto">
            {records.map((entry) => (
              <div key={entry.id} className="border-t pt-3">
                <p className="break-words text-sm font-medium">{entry.name}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.value.tabs.length} Tabs · {new Date(entry.at).toLocaleString("de-DE")}
                </p>
                {entry.value.note && (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{entry.value.note}</p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      if (!connection || useConnectionsStore.getState().activeId !== connection.id)
                        return;
                      try {
                        const tab = restoreInvestigation(connection.id, database, entry.value);
                        if (tab) void navigateToTab(navigate, tab);
                        setOpen(false);
                        toast.success("Arbeitsstand geöffnet");
                      } catch (error) {
                        toast.error(String(error));
                      }
                    }}
                  >
                    Öffnen
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelected(entry.id);
                      setName(entry.name);
                      setNote(entry.value.note);
                    }}
                  >
                    Bearbeiten
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await deleteWorkbenchRecord(entry.id);
                        if (selected === entry.id) reset();
                      })
                    }
                  >
                    Löschen
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
