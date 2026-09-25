import {
  ChevronDownIcon,
  FilePlusIcon,
  FolderOpenIcon,
  PlayIcon,
  SaveIcon,
  SquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useActiveConnection } from "@/lib/connections";
import { useNotebookStore } from "@/lib/notebook";
import {
  exportNotebook,
  newNotebookDraft,
  openNotebook,
  saveNotebook,
} from "@/lib/notebook/actions";
import { NotebookConnectionSelect } from "./notebook-connection-select";

export function NotebookToolbar({
  running,
  onRunAll,
  onCancel,
}: {
  running: boolean;
  onRunAll: () => void;
  onCancel: () => void;
}) {
  const active = useActiveConnection();
  const doc = useNotebookStore((s) => s.doc);
  const dirty = useNotebookStore((s) => s.dirty);
  const filePath = useNotebookStore((s) => s.filePath);
  const recent = useNotebookStore((s) => s.recent);
  const patchDoc = useNotebookStore((s) => s.patchDoc);
  return (
    <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-1.5 border-b bg-card px-3 py-2">
      <Input
        aria-label="Notebook-Name"
        className="h-7 w-56 text-sm font-medium"
        value={doc.name}
        onChange={(event) => patchDoc({ name: event.target.value })}
      />
      <span className="max-w-60 truncate text-[11px] text-muted-foreground" title={filePath ?? ""}>
        {filePath ? filePath.split(/[\\/]/).pop() : "Nicht gespeichert"}
        {dirty ? " •" : ""}
      </span>
      <NotebookConnectionSelect
        label="Notebook-Verbindung"
        inheritLabel={active ? `Aktive Verbindung (${active.name})` : "Aktive Verbindung"}
        value={doc.connectionId}
        onChange={(connectionId) => patchDoc({ connectionId })}
      />
      {running ? (
        <Button size="sm" variant="destructive" className="h-7 gap-1 text-xs" onClick={onCancel}>
          <SquareIcon className="size-3" /> Abbrechen
        </Button>
      ) : (
        <Button size="sm" className="h-7 gap-1 text-xs" onClick={onRunAll}>
          <PlayIcon className="size-3" /> Alle ausführen
        </Button>
      )}
      <div className="ml-auto flex items-center gap-1.5">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch
            checked={doc.saveResults}
            onCheckedChange={(saveResults) => patchDoc({ saveResults })}
          />
          Ergebnisse speichern
        </label>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs"
          onClick={() => newNotebookDraft(active?.id ?? null)}
        >
          <FilePlusIcon className="size-3.5" /> Neu
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs">
              <FolderOpenIcon className="size-3.5" /> Öffnen
              <ChevronDownIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-w-80">
            <DropdownMenuItem onSelect={() => void openNotebook()}>Datei öffnen…</DropdownMenuItem>
            {recent.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px]">Zuletzt geöffnet</DropdownMenuLabel>
                {recent.map((entry) => (
                  <DropdownMenuItem
                    key={entry.path}
                    title={entry.path}
                    onSelect={() => void openNotebook(entry.path)}
                  >
                    <span className="truncate">{entry.name}</span>
                  </DropdownMenuItem>
                ))}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="secondary" className="h-7 gap-1 text-xs">
              <SaveIcon className="size-3.5" /> Speichern
              <ChevronDownIcon className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void saveNotebook(false)}>Speichern</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void saveNotebook(true)}>
              Speichern unter…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void exportNotebook("md")}>
              Export als Markdown…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportNotebook("html")}>
              Export als HTML…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
