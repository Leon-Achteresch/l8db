import { useNavigate } from "@tanstack/react-router";
import { GitBranch, History } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
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
import { Separator } from "@/components/ui/separator";
import { useEditorCheckpoints } from "@/lib/ai/editor/checkpoints";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useTableTabs } from "@/lib/table-tabs";
import { createQueryVariant } from "@/lib/workbench/query-variants";
import {
  deleteWorkbenchRecord,
  type WorkbenchRecord,
  workbenchScope,
} from "@/lib/workbench/records";
import { type SqlState, saveSqlCheckpoint, sqlStateScope } from "@/lib/workbench/sql-states";
import { useWorkbenchRecords } from "@/lib/workbench/use-records";

const DiffEditor = lazy(() =>
  import("@/features/compare/definition-diff-editor").then((module) => ({
    default: module.DefinitionDiffEditor,
  })),
);
const EMPTY: never[] = [];
interface Props {
  connectionId: string;
  database: string | null;
  tabId: string;
  sql: string;
  running: boolean;
  onRestore: (sql: string) => void;
}

export function SqlStatesButton({ connectionId, database, tabId, sql, running, onRestore }: Props) {
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<{ name: string; sql: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const scope = sqlStateScope(connectionId, database, tabId);
  const checkpointScope = workbenchScope(connectionId, database);
  const checkpoints = useWorkbenchRecords<SqlState>("checkpoint", checkpointScope, open);
  const success = useWorkbenchRecords<SqlState>("success", scope, open);
  const ai = useEditorCheckpoints((state) => state.byEditor[tabId] ?? EMPTY);
  const variant = useTableTabs((state) => {
    const tab = state.tabs.find((entry) => entry.kind === "query" && entry.id === tabId);
    return tab?.kind === "query" ? tab.variant : undefined;
  });
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.editor.checkpoints");
  const variantFeature = useNewFeatureVisibility<HTMLButtonElement>("query.editor.variants");
  const successFeature = useNewFeatureVisibility<HTMLButtonElement>("query.editor.last-success");
  const navigate = useNavigate();
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
  const save = (label: string, text: string, source: SqlState["source"] = "manual") =>
    saveSqlCheckpoint(checkpointScope, label, { sql: text, editorId: tabId, source });
  const show = (entry: WorkbenchRecord<SqlState>) =>
    setSelected({ name: entry.name, sql: entry.value.sql });
  return (
    <>
      <Separator orientation="vertical" className="mx-0.5 my-2" />
      <Button
        ref={feature.ref}
        variant="ghost"
        size="sm"
        className="relative size-8 shrink-0 px-0"
        aria-label="SQL-Stände"
        title="SQL-Stände und Varianten"
        onClick={() => {
          setSelected(null);
          setOpen(true);
        }}
      >
        <History className="size-3.5" />
        {feature.isNew && <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>SQL-Stände</DialogTitle>
            <DialogDescription>
              Benannte Stände dieser Datenbank bleiben lokal gespeichert, auch nach dem Schließen
              eines Tabs. Links steht der gewählte Stand, rechts dein aktueller Text.
              Wiederherstellen führt kein SQL aus.
            </DialogDescription>
          </DialogHeader>
          <Button
            ref={variantFeature.ref}
            variant="ghost"
            size="sm"
            disabled={busy || running || !sql.trim()}
            onClick={() => {
              try {
                const id = createQueryVariant(tabId, sql);
                void navigate({ to: "/query/$id", params: { id } });
              } catch (error) {
                toast.error(String(error));
              }
            }}
          >
            <GitBranch className="size-3.5" /> Variante öffnen{" "}
            {variantFeature.isNew && <NewBadge />}
          </Button>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () => {
                await save(name, sql);
                setName("");
                toast.success("SQL-Stand gespeichert");
              });
            }}
          >
            <Input
              aria-label="Name des SQL-Stands"
              placeholder="Zum Beispiel: vor dem neuen Join"
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <Button size="sm" disabled={busy || !name.trim() || !sql.trim()}>
              Stand speichern
            </Button>
          </form>
          <div className="flex min-h-0 flex-col gap-3 overflow-auto sm:flex-row">
            <div className="max-h-60 shrink-0 space-y-1 overflow-auto sm:w-64">
              {variant && (
                <Button
                  className="w-full justify-start truncate"
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setSelected({ name: `Original: ${variant.title}`, sql: variant.sql })
                  }
                >
                  Original der Variante vergleichen
                </Button>
              )}
              {success.records[0] && (
                <Button
                  ref={successFeature.ref}
                  className="w-full justify-start"
                  size="sm"
                  variant="ghost"
                  onClick={() => show(success.records[0])}
                >
                  Letzten Erfolg vergleichen {successFeature.isNew && <NewBadge />}
                </Button>
              )}
              {(checkpoints.loading || success.loading) && (
                <p role="status" className="text-xs text-muted-foreground">
                  Stände werden geladen…
                </p>
              )}
              {(checkpoints.error || success.error) && (
                <p role="alert" className="text-xs text-destructive">
                  {checkpoints.error || success.error}
                </p>
              )}
              {!checkpoints.loading && !checkpoints.records.length && (
                <p className="py-2 text-xs text-muted-foreground">
                  Noch kein benannter Stand. Speichere deinen aktuellen SQL-Text oben.
                </p>
              )}
              {checkpoints.records.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded px-2 py-1.5 text-left text-xs hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => show(entry)}
                  >
                    <span className="block truncate">{entry.name}</span>
                    <span className="text-muted-foreground">
                      {new Date(entry.at).toLocaleString("de-DE")}
                    </span>
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`SQL-Stand ${entry.name} löschen`}
                    onClick={() =>
                      void act(async () => {
                        await deleteWorkbenchRecord(entry.id);
                        if (selected?.name === entry.name) setSelected(null);
                      })
                    }
                  >
                    Löschen
                  </Button>
                </div>
              ))}
              {ai.length > 0 && (
                <p className="pt-3 text-xs font-medium">KI-Stände dieser Sitzung</p>
              )}
              {ai.map((entry) => (
                <div key={entry.id} className="flex items-center gap-1">
                  <Button
                    className="min-w-0 flex-1 justify-start truncate"
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelected({ name: entry.label, sql: entry.before })}
                  >
                    {entry.label}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void act(() => save(entry.label.slice(0, 80), entry.before, "ai"))
                    }
                  >
                    Behalten
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
              {selected ? (
                <>
                  <p className="truncate text-sm font-medium">{selected.name}</p>
                  <div className="h-72 min-h-48 overflow-hidden rounded border">
                    <Suspense
                      fallback={
                        <p role="status" className="p-3 text-sm">
                          Vergleich wird geladen…
                        </p>
                      }
                    >
                      <DiffEditor
                        original={selected.sql}
                        modified={sql}
                        onlyDifferences={false}
                        readOnly
                      />
                    </Suspense>
                  </div>
                  <Button
                    size="sm"
                    className="self-end"
                    disabled={busy || running || selected.sql === sql}
                    onClick={() =>
                      void act(async () => {
                        if (sql.trim()) await save("Vor Wiederherstellung", sql);
                        if (!alive.current) return;
                        onRestore(selected.sql);
                        setOpen(false);
                        toast.success("SQL-Stand wiederhergestellt", {
                          description: "Der vorherige Text wurde als Stand gesichert.",
                        });
                      })
                    }
                  >
                    Im Editor wiederherstellen
                  </Button>
                </>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  Wähle einen Stand zum Vergleichen und Wiederherstellen.
                </p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
