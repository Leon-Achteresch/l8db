import { ArrowRightIcon, PlayIcon } from "lucide-react";
import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { MasterDetailPreview } from "@/features/shell/master-detail-link/master-detail-preview";
import { SavedScriptsPicker } from "@/features/shell/master-detail-link/saved-scripts-picker";
import { MasterDetailRelationPicker } from "@/features/shell/master-detail-relation-picker";
import { PaneNumber } from "@/features/shell/split-pane/pane-number";
import { ConnectionScopeContext, useConnectionsStore } from "@/lib/connections";
import {
  masterColumnReference,
  masterDetailKey,
  masterDetailScriptError,
  qualifyMasterDetail,
  useMasterDetail,
  usePaneSourceKey,
} from "@/lib/master-detail";
import { masterDetailRelationSql } from "@/lib/master-detail-relations";
import type { LinkAnchor } from "@/lib/split-links";
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
  masterIndex,
  detail,
  detailIndex,
  anchor,
  onHover,
}: {
  master?: Tab;
  masterIndex: number;
  detail?: Tab;
  detailIndex: number;
  anchor: LinkAnchor;
  onHover: (hovered: boolean) => void;
}) {
  const masterPaneKey = master ? tabKey(master) : `split-detail:${masterIndex}`;
  const source = usePaneSourceKey(masterPaneKey);
  const target = usePaneSourceKey(detail ? tabKey(detail) : `split-detail:${detailIndex}`);
  const key = masterDetailKey(source, target);
  const masterConnectionId = usePaneConnectionId(masterPaneKey);
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
  const [autoRelation, setAutoRelation] = useState(false);
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
  const loadDraft = useCallback((value: string) => {
    setDraft(value);
    setPreviewSql(null);
  }, []);
  const error = masterDetailScriptError(draft);
  const masterLabel = master ? tabLabel(master) : "Master";
  const detailLabel = detail ? tabLabel(detail) : "Detail";
  const save = () => {
    if (!key || error) return;
    useMasterDetail.getState().saveScript(key, draft, {
      master: masterLabel,
      detail: detailLabel,
    });
    setOpen(false);
  };
  const edit = () => {
    setSavedKey(key && savedScripts[key] ? key : "");
    const tableTab = detail ?? master;
    setAutoRelation(!sql && !(key && savedScripts[key]));
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
      {key && (
        <button
          type="button"
          aria-label={`Master-Detail-SQL bearbeiten (${masterIndex + 1} → ${detailIndex + 1})`}
          title={`${masterIndex + 1} ${masterLabel} → ${detailIndex + 1} ${detailLabel}: ${sql ? "SQL bearbeiten" : "Verknüpfung einrichten"}`}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onFocus={(event) => onHover(event.currentTarget.matches(":focus-visible"))}
          onBlur={() => onHover(false)}
          onClick={edit}
          style={{ left: anchor.x, top: anchor.y }}
          className={cn(
            "pointer-events-auto absolute grid size-6 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border bg-background shadow-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring",
            sql
              ? "border-primary text-primary"
              : "border-dashed border-muted-foreground/60 text-muted-foreground",
          )}
        >
          <ArrowRightIcon
            className="size-3.5 transition-transform duration-200"
            style={{ transform: `rotate(${anchor.angle}deg)` }}
          />
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="flex h-[min(88dvh,60rem)] w-[min(92vw,76rem)] max-w-[92vw] flex-col gap-4 overflow-hidden sm:max-w-[76rem]"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          <DialogHeader>
            <DialogTitle>Master-Detail-SQL</DialogTitle>
            <DialogDescription>
              Das SQL wird aus der Fremdschlüssel-Beziehung vorbelegt. Anwenden reicht; danach folgt
              das Detail der ausgewählten Master-Zeile. Den Master wählst du im Kopf des
              Detail-Bereichs: Ein Master kann mehrere Details haben, und jedes Detail kann selbst
              wieder Master sein.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
            <div className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5 rounded-md border bg-muted/30 px-2 py-1.5">
                <PaneNumber index={masterIndex} />
                Master · {master ? tabLabel(master) : "Abfrage"}
              </span>
              <ArrowRightIcon className="size-3" />
              <span className="flex items-center gap-1.5">
                <PaneNumber index={detailIndex} />
                Detail · {detail ? tabLabel(detail) : "SQL-Ergebnis"}
              </span>
              <span className="ml-auto">
                {selection
                  ? `Ausgewählt: Zeile ${selection.rowIndex + 1}`
                  : "Noch keine Master-Zeile ausgewählt"}
              </span>
            </div>
            <SavedScriptsPicker
              savedKey={savedKey}
              setSavedKey={setSavedKey}
              loadDraft={loadDraft}
            />
            {master?.kind === "table" && sameDatabase && (
              <ConnectionScopeContext.Provider value={masterConnectionId}>
                <MasterDetailRelationPicker
                  schema={master.schema}
                  table={master.table}
                  selectedColumn={selection?.column}
                  target={detail?.kind === "table" ? detail : undefined}
                  autoLoad={autoRelation}
                  onLoad={loadDraft}
                />
              </ConnectionScopeContext.Provider>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-xs font-medium">SQL</span>
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
              <MasterDetailPreview
                previewSql={previewSql}
                draft={draft}
                source={source}
                previewId={previewId}
                targetConnectionId={targetConnectionId}
                setPreviewSql={setPreviewSql}
              />
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
