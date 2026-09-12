import { ArrowDownIcon, ArrowRightIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ResizableHandle } from "@/components/ui/resizable";
import {
  masterDetailKey,
  masterDetailScriptError,
  useMasterDetail,
  usePaneSourceKey,
} from "@/lib/master-detail";
import { tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

const QueryEditorPane = lazy(() =>
  import("@/features/query/query-editor-pane").then((module) => ({
    default: module.QueryEditorPane,
  })),
);
const registry = { schemas: [], tables: [], columns: [] };
const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

export function MasterDetailLink({
  master,
  detail,
  detailIndex,
  vertical = false,
}: {
  master?: Tab;
  detail?: Tab;
  detailIndex: number;
  vertical?: boolean;
}) {
  const source = usePaneSourceKey(master ? tabKey(master) : null);
  const target = usePaneSourceKey(detail ? tabKey(detail) : `split-detail:${detailIndex}`);
  const key = masterDetailKey(source, target);
  const sql = useMasterDetail((state) => (key ? state.scripts[key] : undefined));
  const selection = useMasterDetail((state) => (source ? state.selections[source] : undefined));
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const error = masterDetailScriptError(draft);
  const available =
    key &&
    (master?.kind === "table" || master?.kind === "query") &&
    (!detail || detail.kind === "table" || detail.kind === "query");
  const save = () => {
    if (!key || error) return;
    useMasterDetail.getState().saveScript(key, draft);
    setOpen(false);
  };
  const edit = () => {
    const tableTab = detail ?? master;
    const table =
      tableTab?.kind === "table"
        ? `${quote(tableTab.schema)}.${quote(tableTab.table)}`
        : '"detail_table"';
    setDraft(
      sql ??
        (detail?.kind === "query" && detail.sql.trim() ? detail.sql : null) ??
        `SELECT *\nFROM ${table}\nWHERE ${quote(selection?.column ?? "id")}::text IS NOT DISTINCT FROM :master::text\nLIMIT 100`,
    );
    setOpen(true);
  };
  return (
    <>
      <ResizableHandle withHandle={!available}>
        {available ? (
          <button
            type="button"
            aria-label="Master-Detail-SQL bearbeiten"
            title={`${master ? tabLabel(master) : "Master"} → ${detail ? tabLabel(detail) : "Detail"}: SQL bearbeiten`}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={edit}
            className={cn(
              "relative z-20 grid size-8 shrink-0 place-items-center rounded-full border bg-background shadow-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
              sql ? "border-primary text-primary" : "border-border text-muted-foreground",
            )}
          >
            {vertical ? (
              <ArrowDownIcon className="size-4" />
            ) : (
              <ArrowRightIcon className="size-4" />
            )}
          </button>
        ) : null}
      </ResizableHandle>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="sm:max-w-3xl"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Master-Detail-SQL</DialogTitle>
            <DialogDescription>
              {master ? tabLabel(master) : "Master"} → {detail ? tabLabel(detail) : "Detail"}. Die
              Detail-Abfrage folgt der ausgewählten Zelle im Master.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              :master ist der aktuelle Zellwert als Text oder NULL. Bei Bedarf im SQL casten, z. B.
              :master::integer oder :master::uuid.
            </p>
            <p className="text-xs">
              Ausgewählte Spalte:{" "}
              <strong>{selection?.column ?? "Noch keine Zelle ausgewählt"}</strong>
            </p>
            <div className="h-72 overflow-hidden rounded-md border">
              <Suspense fallback={<p className="p-3 text-sm">SQL-Editor wird geladen…</p>}>
                <QueryEditorPane
                  value={draft}
                  onChange={setDraft}
                  onRun={save}
                  onSave={save}
                  registry={registry}
                />
              </Suspense>
            </div>
            {error && (
              <p role="alert" className="text-xs text-destructive">
                {error}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Speichern aktiviert die Abfrage automatisch und merkt sie lokal für dieses Tab-Paar.
            </p>
          </div>
          <DialogFooter>
            {sql && (
              <Button
                variant="outline"
                onClick={() => {
                  if (key) useMasterDetail.getState().removeScript(key);
                  setOpen(false);
                }}
              >
                Verknüpfung entfernen
              </Button>
            )}
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Abbrechen
            </Button>
            <Button disabled={!key || Boolean(error)} onClick={save}>
              Speichern & anwenden
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
