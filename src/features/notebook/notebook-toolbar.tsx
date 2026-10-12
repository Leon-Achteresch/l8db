import {
  BookOpenIcon,
  ChevronRightIcon,
  DatabaseIcon,
  DownloadIcon,
  EllipsisIcon,
  FilePlusIcon,
  FolderOpenIcon,
  HistoryIcon,
  NotebookIcon,
  PlayIcon,
  RectangleVerticalIcon,
  SaveAllIcon,
  SaveIcon,
  SquareIcon,
} from "lucide-react";
import { IconButton } from "@/components/icon-button";
import {
  IconMenu,
  IconMenuCheckboxItem,
  IconMenuContent,
  IconMenuItem,
  IconMenuRadioItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuSub,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveConnection } from "@/lib/connections";
import { type NotebookLayout, useNotebookLayout, useNotebookStore } from "@/lib/notebook";
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
  const layout = useNotebookLayout((s) => s.layout);
  const setLayout = useNotebookLayout((s) => s.setLayout);
  const state = !filePath
    ? "Nicht gespeichert"
    : dirty
      ? "Ungespeicherte Änderungen"
      : "Gespeichert";
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b bg-card px-3">
      <nav aria-label="Notebook" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="text-muted-foreground">Notebooks</span>
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground/70" />
        <span className="truncate font-medium">{doc.name || "Unbenannt"}</span>
        <span
          className="ml-1.5 shrink-0 truncate text-xs text-muted-foreground"
          title={filePath ?? undefined}
        >
          {state}
        </span>
      </nav>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        <NotebookConnectionSelect
          label="Notebook-Verbindung"
          inheritLabel={active ? active.name : "Aktive Verbindung"}
          value={doc.connectionId}
          onChange={(connectionId) => patchDoc({ connectionId })}
          className="w-44"
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" aria-label="Exportieren">
              <DownloadIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => void exportNotebook("md")}>
              Export als Markdown…
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => void exportNotebook("html")}>
              Export als HTML…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {running ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 gap-1.5 text-xs"
            onClick={onCancel}
          >
            <SquareIcon className="size-3" /> Abbrechen
          </Button>
        ) : (
          <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={onRunAll}>
            <PlayIcon className="size-3" /> Alle ausführen
            <span className="text-[10px] opacity-70">⇧⌘↵</span>
          </Button>
        )}
        <IconMenu>
          <DropdownMenuTrigger asChild>
            <IconButton variant="ghost" size="icon-sm" aria-label="Weitere Notebook-Aktionen">
              <EllipsisIcon />
            </IconButton>
          </DropdownMenuTrigger>
          <IconMenuContent>
            <IconMenuItem
              icon={<FilePlusIcon />}
              label="Neues Notebook"
              onSelect={() => newNotebookDraft(active?.id ?? null)}
            />
            <IconMenuItem
              icon={<FolderOpenIcon />}
              label="Datei öffnen…"
              onSelect={() => void openNotebook()}
            />
            {recent.length > 0 && (
              <DropdownMenuSub>
                <IconMenuSubTrigger icon={<HistoryIcon />} label="Zuletzt geöffnet" />
                <IconMenuSubContent>
                  {recent.map((entry) => (
                    <IconMenuItem
                      key={entry.path}
                      icon={<NotebookIcon />}
                      label={entry.name}
                      onSelect={() => void openNotebook(entry.path)}
                    />
                  ))}
                </IconMenuSubContent>
              </DropdownMenuSub>
            )}
            <IconMenuSeparator />
            <IconMenuItem
              icon={<SaveIcon />}
              label="Speichern"
              shortcut="⌘S"
              onSelect={() => void saveNotebook(false)}
            />
            <IconMenuItem
              icon={<SaveAllIcon />}
              label="Speichern unter…"
              shortcut="⇧⌘S"
              onSelect={() => void saveNotebook(true)}
            />
            <IconMenuSeparator />
            <DropdownMenuRadioGroup
              value={layout}
              onValueChange={(value) => setLayout(value as NotebookLayout)}
            >
              <IconMenuRadioItem
                icon={<RectangleVerticalIcon />}
                label="Ansicht: Spalte"
                value="column"
              />
              <IconMenuRadioItem icon={<BookOpenIcon />} label="Ansicht: Buch" value="book" />
            </DropdownMenuRadioGroup>
            <IconMenuSeparator />
            <IconMenuCheckboxItem
              icon={<DatabaseIcon />}
              label="Ergebnisse mitspeichern"
              checked={doc.saveResults}
              onCheckedChange={(saveResults) => patchDoc({ saveResults: Boolean(saveResults) })}
              onSelect={(event) => event.preventDefault()}
            />
          </IconMenuContent>
        </IconMenu>
      </div>
    </div>
  );
}
