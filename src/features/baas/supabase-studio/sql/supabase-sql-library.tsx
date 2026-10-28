import { PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SupabaseSqlNameDialog } from "./supabase-sql-name-dialog";
import type {
  SupabaseSqlHistoryEntry,
  SupabaseSqlProjectState,
  SupabaseSqlSnippet,
} from "./supabase-sql-store";

const time = new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" });

export function SupabaseSqlLibrary({
  project,
  onOpen,
  onRenameSnippet,
  onDeleteSnippet,
  onClearHistory,
}: {
  project: SupabaseSqlProjectState;
  onOpen: (sql: string) => void;
  onRenameSnippet: (id: string, name: string) => void;
  onDeleteSnippet: (id: string) => void;
  onClearHistory: () => void;
}) {
  const [renaming, setRenaming] = useState<SupabaseSqlSnippet | null>(null);
  const [deleting, setDeleting] = useState<SupabaseSqlSnippet | null>(null);
  const [clearing, setClearing] = useState(false);

  const historyItem = (entry: SupabaseSqlHistoryEntry) => (
    <li key={entry.id}>
      <button
        type="button"
        onClick={() => onOpen(entry.sql)}
        className="w-full rounded-md px-2 py-1.5 text-left hover:bg-muted"
        title="In neuem Tab öffnen"
      >
        <pre className="line-clamp-2 font-mono text-[11px] break-all whitespace-pre-wrap">
          {entry.sql}
        </pre>
        <span className={`text-[10px] ${entry.ok ? "text-muted-foreground" : "text-destructive"}`}>
          {time.format(entry.at)}
          {entry.ok
            ? ` · ${entry.rows ?? 0} Zeilen · ${entry.durationMs ?? 0} ms`
            : " · fehlgeschlagen"}
        </span>
      </button>
    </li>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tabs defaultValue="snippets" className="flex min-h-0 flex-1 flex-col gap-0">
        <TabsList className="mb-2 w-full">
          <TabsTrigger value="snippets">Snippets ({project.snippets.length})</TabsTrigger>
          <TabsTrigger value="history">Verlauf ({project.history.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="snippets" className="min-h-0 overflow-auto">
          {project.snippets.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              Noch keine Snippets. Speichere die aktuelle Abfrage über „Als Snippet speichern“.
            </p>
          ) : (
            <ul className="grid gap-0.5">
              {project.snippets.map((snippet) => (
                <li
                  key={snippet.id}
                  className="group flex items-center gap-1 rounded-md hover:bg-muted"
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                    title={snippet.sql}
                    onClick={() => onOpen(snippet.sql)}
                  >
                    {snippet.name}
                  </button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`${snippet.name} öffnen`}
                    onClick={() => onOpen(snippet.sql)}
                  >
                    <PlayIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7"
                    aria-label={`${snippet.name} umbenennen`}
                    onClick={() => setRenaming(snippet)}
                  >
                    <PencilIcon className="size-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="size-7 text-destructive"
                    aria-label={`${snippet.name} löschen`}
                    onClick={() => setDeleting(snippet)}
                  >
                    <Trash2Icon className="size-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
        <TabsContent value="history" className="min-h-0 overflow-auto">
          {project.history.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              Noch keine Abfragen ausgeführt.
            </p>
          ) : (
            <>
              <ul className="grid gap-0.5">{project.history.map(historyItem)}</ul>
              <Button
                size="sm"
                variant="ghost"
                className="mt-2 h-7 w-full text-xs"
                onClick={() => setClearing(true)}
              >
                Verlauf leeren
              </Button>
            </>
          )}
        </TabsContent>
      </Tabs>
      {renaming && (
        <SupabaseSqlNameDialog
          title="Snippet umbenennen"
          initial={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            onRenameSnippet(renaming.id, name);
            setRenaming(null);
          }}
        />
      )}
      <AlertDialog
        open={deleting !== null || clearing}
        onOpenChange={(open) => {
          if (!open) {
            setDeleting(null);
            setClearing(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{clearing ? "Verlauf leeren?" : "Snippet löschen?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {clearing
                ? "Alle Einträge im Verlauf dieses Projekts werden entfernt."
                : `„${deleting?.name}“ wird endgültig gelöscht.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (clearing) onClearHistory();
                else if (deleting) onDeleteSnippet(deleting.id);
                setDeleting(null);
                setClearing(false);
              }}
            >
              {clearing ? "Leeren" : "Löschen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
