import {
  ArrowRightIcon,
  GitCompareIcon,
  LoaderIcon,
  RefreshCwIcon,
  SearchIcon,
  Settings2Icon,
} from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { CatalogObjectType } from "@/lib/db";
import { buildSyncScript, renderSyncScript } from "@/lib/schema-compare/script";
import { runSchemaCompare, useSchemaCompareStore } from "@/lib/schema-compare/store";
import type { DiffStatus } from "@/lib/schema-compare/types";
import { OBJECT_TYPE_META } from "@/lib/schema-compare/types";
import { SchemaCompareDetail } from "./schema-compare-detail";
import { SchemaCompareScript } from "./schema-compare-script";
import { SchemaCompareSetup } from "./schema-compare-setup";
import { SchemaCompareSummary } from "./schema-compare-summary";
import { SchemaCompareTree } from "./schema-compare-tree";

type DetailTab = "details" | "summary" | "script";

export function SchemaCompareView() {
  const result = useSchemaCompareStore((state) => state.result);
  const selection = useSchemaCompareStore((state) => state.selection);
  const activeKey = useSchemaCompareStore((state) => state.activeKey);
  const loading = useSchemaCompareStore((state) => state.loading);
  const error = useSchemaCompareStore((state) => state.error);
  const set = useSchemaCompareStore.setState;
  const [setupOpen, setSetupOpen] = useState(false);
  const [tab, setTab] = useState<DetailTab>("details");
  const [query, setQuery] = useState("");
  const [showIdentical, setShowIdentical] = useState(false);
  const [focus, setFocus] = useState<{ type: CatalogObjectType; status: DiffStatus } | null>(null);
  const search = useDeferredValue(query.trim().toLowerCase());

  const items = useMemo(() => {
    if (!result) return [];
    return result.items.filter(
      (item) =>
        (showIdentical || item.status !== "identical" || focus?.status === "identical") &&
        (!focus || (item.status === focus.status && item.type === focus.type)) &&
        (!search ||
          item.name.toLowerCase().includes(search) ||
          (item.parent ?? "").toLowerCase().includes(search) ||
          OBJECT_TYPE_META[item.type].label.toLowerCase().includes(search)),
    );
  }, [result, showIdentical, focus, search]);

  const script = useMemo(
    () => (result ? buildSyncScript(result, selection) : { statements: [], warnings: [] }),
    [result, selection],
  );
  const text = useMemo(
    () =>
      result
        ? renderSyncScript(script, {
            kind: result.kind,
            sourceLabel: result.sourceLabel,
            targetLabel: result.targetLabel,
          })
        : "",
    [result, script],
  );
  const selectedCount = result
    ? result.items.filter((item) => selection[item.key] && item.status !== "identical").length
    : 0;
  const actionable = items.filter((item) => item.status !== "identical").map((item) => item.key);

  const toggle = (keys: string[], checked: boolean) =>
    set((state) => {
      const next = { ...state.selection };
      for (const key of keys) {
        if (checked) next[key] = true;
        else delete next[key];
      }
      return { selection: next };
    });

  return (
    <div className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <GitCompareIcon className="size-4 text-indigo-500" />
        <span className="text-sm font-medium">Schema-Vergleich</span>
        {result && (
          <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{result.sourceLabel}</span>
            <ArrowRightIcon className="size-3 shrink-0" />
            <span className="truncate">{result.targetLabel}</span>
            <span className="shrink-0">
              ·{" "}
              {new Date(result.comparedAt).toLocaleTimeString("de-DE", {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {result && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setSetupOpen(true)}
              >
                <Settings2Icon className="size-3.5" />
                Einstellungen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                disabled={Boolean(loading)}
                onClick={() => void runSchemaCompare()}
              >
                <RefreshCwIcon className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
                Neu vergleichen
              </Button>
            </>
          )}
        </div>
      </div>

      {!result ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <SchemaCompareSetup />
        </div>
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel
            id="schema-compare-tree"
            defaultSize="46%"
            minSize="25%"
            className="flex min-w-0 flex-col"
          >
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-2 py-1.5">
              <div className="relative min-w-40 flex-1">
                <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Objekt, Tabelle oder Typ suchen"
                  className="h-7 pl-7 text-xs"
                  aria-label="Unterschiede filtern"
                />
              </div>
              <Label className="flex items-center gap-1.5 text-xs font-normal">
                <Switch checked={showIdentical} onCheckedChange={setShowIdentical} />
                Identische
              </Label>
            </div>
            <div className="flex shrink-0 items-center gap-1 border-b px-2 py-1 text-xs text-muted-foreground">
              <span>{selectedCount} ausgewählt</span>
              {focus && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => setFocus(null)}
                >
                  Nur {OBJECT_TYPE_META[focus.type].plural} · Filter aufheben
                </Button>
              )}
              <div className="ml-auto flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => toggle(actionable, true)}
                >
                  Alle
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 text-xs"
                  onClick={() => toggle(actionable, false)}
                >
                  Keine
                </Button>
              </div>
            </div>
            {!showIdentical && result.items.every((item) => item.status === "identical") ? (
              <div className="flex flex-1 items-center justify-center p-6 text-xs text-muted-foreground">
                Keine Unterschiede gefunden.
              </div>
            ) : (
              <SchemaCompareTree
                result={result}
                items={items}
                selection={selection}
                activeKey={activeKey}
                expandAll={Boolean(search) || Boolean(focus)}
                onToggle={toggle}
                onActivate={(key) => {
                  set({ activeKey: key });
                  setTab("details");
                }}
              />
            )}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            id="schema-compare-detail"
            minSize="30%"
            className="flex min-w-0 flex-col"
          >
            <Tabs
              value={tab}
              onValueChange={(value) => setTab(value as DetailTab)}
              className="flex min-h-0 flex-1 flex-col gap-0"
            >
              <TabsList className="mx-2 mt-1.5 shrink-0 justify-start bg-transparent">
                <TabsTrigger value="details">Details</TabsTrigger>
                <TabsTrigger value="summary">Zusammenfassung</TabsTrigger>
                <TabsTrigger value="script">Sync-Skript ({script.statements.length})</TabsTrigger>
              </TabsList>
              <TabsContent value="details" className="flex min-h-0 flex-1 flex-col">
                <SchemaCompareDetail result={result} activeKey={activeKey} />
              </TabsContent>
              <TabsContent value="summary" className="flex min-h-0 flex-1 flex-col">
                <SchemaCompareSummary
                  result={result}
                  onPick={(type, status) => setFocus({ type, status })}
                />
              </TabsContent>
              <TabsContent value="script" className="flex min-h-0 flex-1 flex-col">
                <SchemaCompareScript result={result} script={script} text={text} />
              </TabsContent>
            </Tabs>
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {result && (error || loading) && (
        <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t bg-background/95 px-3 py-2 text-xs">
          {loading ? (
            <>
              <LoaderIcon className="size-3.5 animate-spin" />
              {loading}
            </>
          ) : (
            <span className="whitespace-pre-wrap text-destructive">{error}</span>
          )}
        </div>
      )}

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="max-h-[90vh] overflow-auto sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Schema-Vergleich einrichten</DialogTitle>
          </DialogHeader>
          <SchemaCompareSetup onStarted={() => setSetupOpen(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
