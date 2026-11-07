import { useQueryClient } from "@tanstack/react-query";
import { ListIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { dropEnumSql } from "@/lib/enum-ddl";
import { useEnumsQuery } from "@/lib/queries";
import { effectiveConnectionString } from "@/lib/ssh";
import { CreateEnumDialog } from "./enums-view/create-enum-dialog";
import { EnumEntryCard } from "./enums-view/enum-entry-card";

export function EnumsView() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<{ schema: string; name: string } | null>(null);
  const { data: enums, isLoading } = useEnumsQuery();

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["enums"] });
  };

  const handleDrop = async () => {
    if (!connection || !dropTarget) return;
    try {
      await executeQuery(
        connection.kind,
        effectiveConnectionString(connection),
        dropEnumSql(dropTarget.schema, dropTarget.name),
        database ?? undefined,
      );
      toast.success(`Enum "${dropTarget.name}" gelöscht.`);
      refresh();
    } catch (err) {
      toast.error(typeof err === "string" ? err : String(err));
    } finally {
      setDropTarget(null);
    }
  };

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  return (
    <main className="mx-auto flex h-full w-full max-w-6xl min-h-0 flex-col gap-4 p-6">
      <header className="flex shrink-0 items-center gap-2">
        <ListIcon className="size-5 text-primary" />
        <h1 className="text-xl font-bold tracking-tight">Enum-Typen</h1>
        <Button
          size="sm"
          className="ml-auto h-8 gap-1.5 text-xs"
          onClick={() => setDialogOpen(true)}
        >
          <PlusIcon className="size-3.5" />
          Neuer Enum
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Lade Enums…</p>
        ) : (enums?.length ?? 0) === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <ListIcon />
              </EmptyMedia>
              <EmptyTitle>Keine Enum-Typen</EmptyTitle>
              <EmptyDescription>
                Enums beschränken eine Spalte auf eine feste Liste von Werten, etwa Status oder
                Kategorien.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="outline" onClick={() => setDialogOpen(true)}>
                <PlusIcon data-icon="inline-start" />
                Enum anlegen
              </Button>
            </EmptyContent>
          </Empty>
        ) : (
          <div className="flex flex-col gap-2">
            {enums?.map((entry) => (
              <EnumEntryCard
                key={`${entry.schema}.${entry.name}`}
                entry={entry}
                onChanged={refresh}
                onDrop={() => setDropTarget({ schema: entry.schema, name: entry.name })}
              />
            ))}
          </div>
        )}
      </div>

      <CreateEnumDialog open={dialogOpen} onOpenChange={setDialogOpen} onSuccess={refresh} />
      <AlertDialog
        open={dropTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDropTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enum-Typ &quot;{dropTarget?.schema}.{dropTarget?.name}&quot; löschen?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Der Typ wird unwiderruflich gelöscht. Spalten, die ihn nutzen, verhindern das Löschen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleDrop()}>Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
