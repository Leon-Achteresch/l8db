import { ArrowDownIcon, ArrowRightIcon, PlayIcon, XIcon } from "lucide-react";
import { lazy, Suspense, useRef, useState } from "react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { MasterDetailRelationPicker } from "@/features/shell/master-detail-relation-picker";
import { MasterDetailResult } from "@/features/shell/master-detail-result";
import { ConnectionScopeContext, useConnectionsStore } from "@/lib/connections";
import {
  MasterSelectionContext,
  masterColumnReference,
  masterDetailKey,
  masterDetailScriptError,
  qualifyMasterDetail,
  useMasterDetail,
  usePaneSourceKey,
} from "@/lib/master-detail";
import { masterDetailRelationSql } from "@/lib/master-detail-relations";
import { usePaneConnectionId } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";
import { type Tab, tabKey } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

const QueryEditorPane = lazy(() =>
  import("@/features/query/query-editor-pane").then((module) => ({
    default: module.QueryEditorPane,
  })),
);
const registry = { schemas: [], tables: [], columns: [] };

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
  const masterConnectionId = usePaneConnectionId(master ? tabKey(master) : null);
  const sameDatabase =
    source &&
    target &&
    JSON.stringify(JSON.parse(source).slice(2)) === JSON.stringify(JSON.parse(target).slice(2));
  const sql = useMasterDetail((state) => (key ? state.scripts[key] : undefined));
  const selection = useMasterDetail((state) => (source ? state.selections[source] : undefined));
  const savedScripts = useMasterDetail((state) => state.savedScripts);
  const [savedKey, setSavedKey] = useState("");
  const [open, setOpen] = useState(false);
  const sourceColumn = useMasterDetail((state) => (key ? state.sourceColumns[key] : undefined));
  const [draft, setDraft] = useState("");
  const [previewSql, setPreviewSql] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState(0);
  const editorRef = useRef<QueryEditorApi>(null);
  const targetConnectionId = usePaneConnectionId(
    detail ? tabKey(detail) : `split-detail:${detailIndex}`,
  );
  const targetKind = useConnectionsStore(
    (state) =>
      state.connections.find((entry) => entry.id === (targetConnectionId ?? state.activeId))?.kind,
  );
  const preview = () => {
    if (masterDetailScriptError(draft) || !selection) return;
    setPreviewSql(draft);
    setPreviewId((value) => value + 1);
  };
  const loadDraft = (value: string) => {
    setDraft(value);
    setPreviewSql(null);
  };
  const error = masterDetailScriptError(draft);
  const available =
    key &&
    (master?.kind === "table" || master?.kind === "query") &&
    (!detail || detail.kind === "table" || detail.kind === "query");
  const save = () => {
    if (!key || error) return;
    useMasterDetail.getState().saveScript(key, draft, {
      master: master ? tabLabel(master) : "Master",
      detail: detail ? tabLabel(detail) : "Detail",
    });
    setOpen(false);
  };
  const edit = () => {
    setSavedKey(key && savedScripts[key] ? key : "");
    const tableTab = detail ?? master;
    setDraft(
      (sql ? qualifyMasterDetail(sql, sourceColumn) : undefined) ??
        (key && savedScripts[key]
          ? qualifyMasterDetail(savedScripts[key].sql, savedScripts[key].column)
          : undefined) ??
        (detail?.kind === "query" && detail.sql.trim() ? detail.sql : null) ??
        masterDetailRelationSql(
          {
            id: "manual",
            constraint: "",
            direction: "child",
            schema: tableTab?.kind === "table" ? tableTab.schema : "public",
            table: tableTab?.kind === "table" ? tableTab.table : "detail_table",
            columns: [{ source: selection?.column ?? "id", target: selection?.column ?? "id" }],
          },
          targetKind ?? "postgres",
        ),
    );
    setPreviewSql(null);
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
          className="flex h-[min(88dvh,60rem)] w-[min(92vw,76rem)] max-w-[92vw] flex-col gap-4 overflow-hidden sm:max-w-[76rem]"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Master-Detail-SQL</DialogTitle>
            <DialogDescription>
              Beziehung auswählen, SQL prüfen, anwenden. Die Details folgen danach deiner
              Master-Zeile.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md border bg-muted/30 px-2 py-1.5">
                Master · {master ? tabLabel(master) : "Abfrage"}
              </span>
              <ArrowRightIcon className="size-3" />
              <span>Detail · {detail ? tabLabel(detail) : "SQL-Ergebnis"}</span>
              <span className="ml-auto">
                {selection
                  ? `Ausgewählt: Zeile ${selection.rowIndex + 1}`
                  : "Noch keine Master-Zeile ausgewählt"}
              </span>
            </div>
            <details className="shrink-0 rounded-md border px-3 py-2">
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Gespeicherte SQL-Vorlagen
              </summary>
              <div className="mt-2 flex items-center gap-2">
                <Select value={savedKey} onValueChange={setSavedKey}>
                  <SelectTrigger
                    className="min-w-0 flex-1"
                    aria-label="Gespeichertes Master-Detail-SQL"
                  >
                    <SelectValue placeholder="Gespeichertes Tabellenpaar auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(savedScripts).map(([id, entry]) => (
                      <SelectItem key={id} value={id}>
                        {entry.master} → {entry.detail}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  disabled={!savedScripts[savedKey]}
                  onClick={() => {
                    loadDraft(
                      qualifyMasterDetail(
                        savedScripts[savedKey].sql,
                        savedScripts[savedKey].column,
                      ),
                    );
                  }}
                >
                  SQL laden
                </Button>
                <Button
                  variant="ghost"
                  disabled={!savedScripts[savedKey]}
                  onClick={() => {
                    useMasterDetail.getState().removeSavedScript(savedKey);
                    setSavedKey("");
                  }}
                >
                  Vorlage löschen
                </Button>
              </div>
            </details>
            {master?.kind === "table" && sameDatabase && (
              <ConnectionScopeContext.Provider value={masterConnectionId}>
                <MasterDetailRelationPicker
                  schema={master.schema}
                  table={master.table}
                  selectedColumn={selection?.column}
                  target={detail?.kind === "table" ? detail : undefined}
                  onLoad={loadDraft}
                />
              </ConnectionScopeContext.Provider>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium">2 · SQL</span>
              <span className="text-xs text-muted-foreground">Master-Wert einfügen:</span>
              <select
                aria-label="Master-Spaltenreferenz einfügen"
                value=""
                onChange={(event) => {
                  if (event.target.value)
                    editorRef.current?.insertText(masterColumnReference(event.target.value));
                }}
                className="min-w-0 rounded-md border bg-background px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                disabled={!selection}
              >
                <option value="">:master.SPALTE</option>
                {Object.keys(
                  selection?.row ?? (selection ? { [selection.column]: selection.value } : {}),
                )
                  .filter((name) => name !== "__ctid__")
                  .map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="min-h-48 flex-1 overflow-hidden rounded-md border">
              <Suspense fallback={<p className="p-3 text-sm">SQL-Editor wird geladen…</p>}>
                <QueryEditorPane
                  ref={editorRef}
                  value={draft}
                  onChange={setDraft}
                  onRun={preview}
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
            {previewSql && source && (
              <section
                aria-label="SQL-Vorschau"
                className="flex min-h-40 max-h-[35vh] flex-1 flex-col overflow-hidden rounded-md border"
              >
                <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1 text-xs">
                  <span className="flex-1">
                    {previewSql === draft
                      ? "Ergebnis für die aktuelle Master-Zeile"
                      : "SQL geändert · Vorschau erneut laden"}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Vorschau schließen"
                    onClick={() => setPreviewSql(null)}
                  >
                    <XIcon />
                  </Button>
                </div>
                <ConnectionScopeContext.Provider value={targetConnectionId}>
                  <MasterSelectionContext.Provider value={null}>
                    <MasterDetailResult key={previewId} source={source} sql={previewSql} preview />
                  </MasterSelectionContext.Provider>
                </ConnectionScopeContext.Provider>
              </section>
            )}
          </div>
          <DialogFooter className="shrink-0 items-center">
            <span className="mr-auto text-xs text-muted-foreground">
              {selection
                ? "Anwenden speichert SQL und aktiviert die Detailansicht."
                : "Wähle nach dem Anwenden eine Zeile im Master."}
            </span>
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
            <Button
              variant="outline"
              disabled={Boolean(error) || !selection}
              onClick={preview}
              title={
                !selection
                  ? "Zuerst eine Master-Zeile auswählen"
                  : "SQL für die ausgewählte Master-Zeile ausführen"
              }
            >
              <PlayIcon className="size-3.5" />
              Vorschau
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
