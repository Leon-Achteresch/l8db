import { SquareTerminalIcon, TableIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { pasteText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections";
import {
  openSharedTabWithToast,
  requestSharedTab,
  useSharedTabRequest,
} from "@/lib/shared-tab-open";
import {
  effectiveSharedView,
  parseSharedTabLink,
  resolveSharedConnection,
  type SharedTab,
  sharedTabLabel,
  sharedTabSource,
} from "@/lib/shared-tabs";

const EDITABLE =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), .monaco-editor, .cm-editor';
const PREVIEW_LIMIT = 20_000;

function preview(tab: SharedTab): string {
  const view = tab.kind === "table" ? effectiveSharedView(tab.view) : null;
  const order = view?.sorting?.map((entry) => `${entry.id}${entry.desc ? " DESC" : ""}`).join(", ");
  const text =
    tab.kind === "query"
      ? tab.sql
      : [view?.filter && `WHERE ${view.filter}`, order && `ORDER BY ${order}`]
          .filter(Boolean)
          .join("\n");
  return text.length > PREVIEW_LIMIT ? `${text.slice(0, PREVIEW_LIMIT)}\n…` : text;
}

export function SharedTabDialog() {
  const pending = useSharedTabRequest((state) => state.pending);
  const close = useSharedTabRequest((state) => state.close);
  const connections = useConnectionsStore((state) => state.connections);
  const activeId = useConnectionsStore((state) => state.activeId);
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "v" || !(event.metaKey || event.ctrlKey)) return;
      if (event.altKey || event.shiftKey || useSharedTabRequest.getState().pending) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest(EDITABLE) || target?.closest('[role="dialog"]')) return;
      void pasteText()
        .then(parseSharedTabLink)
        .then((shared) => {
          if (shared) requestSharedTab(shared, "link");
        })
        .catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const tab = pending?.tab ?? null;
  const suggested = useMemo(
    () => (tab ? resolveSharedConnection(tab.connection, connections) : null),
    [tab, connections],
  );
  const options = useMemo(
    () =>
      tab
        ? [...connections].sort(
            (left, right) =>
              Number(right.kind === tab.connection.kind) -
                Number(left.kind === tab.connection.kind) || left.name.localeCompare(right.name),
          )
        : [],
    [tab, connections],
  );
  const target = picked ?? suggested?.id ?? activeId;
  const text = tab ? preview(tab) : "";
  const Icon = tab?.kind === "query" ? SquareTerminalIcon : TableIcon;

  const dismiss = () => {
    setPicked(null);
    close();
  };

  const confirm = () => {
    if (!tab || !target) return;
    dismiss();
    openSharedTabWithToast(tab, target);
  };

  return (
    <Dialog open={tab !== null} onOpenChange={(open) => !open && dismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex min-w-0 items-center gap-2">
            <Icon className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">
              {tab?.kind === "table" && tab.schema ? `${tab.schema}.` : ""}
              {tab ? sharedTabLabel(tab) : ""}
            </span>
          </DialogTitle>
          <DialogDescription className="truncate">
            {tab ? sharedTabSource(tab) : ""}
          </DialogDescription>
        </DialogHeader>
        {tab?.kind === "table" && tab.view.filterRaw && (
          <span className="-mb-4 w-fit rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
            Roh-SQL
          </span>
        )}
        {text && (
          <pre
            data-testid="shared-tab-preview"
            className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-2.5 font-mono text-xs"
          >
            {text}
          </pre>
        )}
        <Select value={target ?? undefined} onValueChange={setPicked}>
          <SelectTrigger aria-label="Verbindung" className="w-full">
            <SelectValue placeholder="Verbindung wählen" />
          </SelectTrigger>
          <SelectContent>
            {options.map((connection) => (
              <SelectItem key={connection.id} value={connection.id}>
                {connection.name}
                <span className="text-[10px] text-muted-foreground">{connection.kind}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <DialogFooter>
          <Button variant="ghost" onClick={dismiss}>
            Abbrechen
          </Button>
          <Button disabled={!target} onClick={confirm}>
            Öffnen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
