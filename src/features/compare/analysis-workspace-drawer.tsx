import { FolderOpenIcon, Trash2Icon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  type AnalysisWorkspace,
  saveAnalysisWorkspace,
  useAnalysisWorkspaces,
} from "@/lib/analysis-workspaces";
import { useConnectionsStore } from "@/lib/connections";

export function AnalysisWorkspaceDrawer({
  value,
  onLoad,
}: {
  value: Omit<AnalysisWorkspace, "id" | "name">;
  onLoad: (value: AnalysisWorkspace) => void;
}) {
  const nameId = useId();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const workspaces = useAnalysisWorkspaces((state) => state.workspaces);
  const connections = useConnectionsStore((state) => state.connections);
  const saved = workspaces.filter((entry) => entry.tab === "definitions");
  const load = (workspace: AnalysisWorkspace) => {
    if (
      [workspace.left, workspace.right].some(
        (side) =>
          side.connectionId &&
          !connections.some((connection) => connection.id === side.connectionId),
      )
    ) {
      toast.error("Eine gespeicherte Verbindung existiert nicht mehr.");
      return;
    }
    onLoad(workspace);
    setName(workspace.name);
    setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="icon-sm" variant="ghost" aria-label="Arbeitsstände" title="Arbeitsstände">
          <FolderOpenIcon className="size-3.5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-0">
        <SheetHeader>
          <SheetTitle>Arbeitsstände</SheetTitle>
          <SheetDescription>Vergleichsauswahl speichern und später wieder öffnen.</SheetDescription>
        </SheetHeader>
        <form
          className="space-y-3 border-b px-4 pb-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            saveAnalysisWorkspace({ ...value, name });
            toast.success("Analyse-Arbeitsstand gespeichert");
            setName("");
          }}
        >
          <label htmlFor={nameId} className="text-xs font-medium">
            Aktuellen Vergleich speichern
          </label>
          <Input
            id={nameId}
            aria-label="Name des Arbeitsstands"
            placeholder="Name des Arbeitsstands"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!name.trim()} className="w-full">
            Speichern
          </Button>
          {saved.some((entry) => entry.name === name.trim()) && (
            <p className="text-xs text-muted-foreground">
              Der gleichnamige Arbeitsstand wird ersetzt.
            </p>
          )}
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {saved.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              Noch keine Arbeitsstände gespeichert.
            </p>
          ) : (
            <ul className="space-y-1">
              {saved.map((entry) => (
                <li key={entry.id} className="flex items-center gap-1 rounded-md hover:bg-muted/50">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-md p-3 text-left focus-visible:outline-ring"
                    onClick={() => load(entry)}
                  >
                    <span className="block truncate text-sm font-medium">{entry.name}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {entry.left.objectName ?? "Quelle"} → {entry.right.objectName ?? "Ziel"}
                    </span>
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${entry.name} entfernen`}
                    title="Arbeitsstand entfernen"
                    onClick={() =>
                      useAnalysisWorkspaces.setState((state) => ({
                        workspaces: state.workspaces.filter((item) => item.id !== entry.id),
                      }))
                    }
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
