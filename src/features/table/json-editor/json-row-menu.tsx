import {
  ArrowDownAZIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardCopyIcon,
  CopyPlusIcon,
  CornerDownRightIcon,
  DatabaseZapIcon,
  EllipsisIcon,
  PackageIcon,
  PackageOpenIcon,
  PencilIcon,
  PlusIcon,
  RouteIcon,
  ShapesIcon,
  TextCursorInputIcon,
  Trash2Icon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type JsonKind, type JsonRow, parseEmbeddedJson } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { JSON_KIND_META, JsonTypeIcon } from "./json-type-icon";
import type { JsonActions } from "./types";

const KINDS: JsonKind[] = ["string", "number", "boolean", "null", "object", "array"];

type Props = {
  row: JsonRow;
  readOnly: boolean;
  actions: JsonActions;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function JsonRowMenu({ row, readOnly, actions, open, onOpenChange }: Props) {
  const { path } = row;
  const isRoot = path.length === 0;
  const inObject = typeof row.key === "string";
  const container = row.kind === "object" || row.kind === "array";
  const embedded = row.kind === "string" && parseEmbeddedJson(row.value as string) !== undefined;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={(event) => event.stopPropagation()}
          className={cn(
            "ml-1 inline-flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
            open
              ? "opacity-100"
              : "opacity-0 group-hover/row:opacity-100 group-data-[selected=true]/row:opacity-100",
          )}
          aria-label="Aktionen"
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-60"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuLabel className="flex items-center gap-2 text-xs">
          <JsonTypeIcon kind={row.kind} />
          <span className="truncate font-mono">{isRoot ? "Wurzel" : String(row.key)}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!readOnly && !container && (
          <DropdownMenuItem onSelect={() => actions.startEdit(path, "value")}>
            <PencilIcon />
            Wert bearbeiten
            <DropdownMenuShortcut>↵</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        {!readOnly && inObject && (
          <DropdownMenuItem onSelect={() => actions.startEdit(path, "key")}>
            <TextCursorInputIcon />
            Schlüssel umbenennen
            <DropdownMenuShortcut>F2</DropdownMenuShortcut>
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <ClipboardCopyIcon />
            Kopieren
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-64">
            <DropdownMenuItem onSelect={() => actions.copy(path, "value")}>
              <ClipboardCopyIcon />
              Wert
              <DropdownMenuShortcut>⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            {inObject && (
              <DropdownMenuItem onSelect={() => actions.copy(path, "key")}>
                <TextCursorInputIcon />
                Schlüssel
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => actions.copy(path, "jsonpath")}>
              <RouteIcon />
              JSONPath
              <DropdownMenuShortcut>⇧⌘C</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.copy(path, "js")}>
              <RouteIcon />
              JavaScript-Zugriff
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.copy(path, "pg")}>
              <DatabaseZapIcon />
              SQL-Ausdruck (-&gt; / -&gt;&gt;)
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.copy(path, "pgpath")}>
              <DatabaseZapIcon />
              SQL-Pfad (#&gt;)
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {container && (
          <>
            <DropdownMenuItem onSelect={() => actions.expandDeep(path, true)}>
              <ChevronsUpDownIcon />
              Alles darunter aufklappen
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.expandDeep(path, false)}>
              <ChevronsDownUpIcon />
              Alles darunter zuklappen
            </DropdownMenuItem>
          </>
        )}
        {!readOnly && (
          <>
            <DropdownMenuSeparator />
            {container && (
              <DropdownMenuItem onSelect={() => actions.addChild(path)}>
                <PlusIcon />
                {row.kind === "array" ? "Element anhängen" : "Schlüssel hinzufügen"}
                <DropdownMenuShortcut>⌘↵</DropdownMenuShortcut>
              </DropdownMenuItem>
            )}
            {!isRoot && (
              <>
                <DropdownMenuItem onSelect={() => actions.insertAfter(path)}>
                  <CornerDownRightIcon />
                  Danach einfügen
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.duplicate(path)}>
                  <CopyPlusIcon />
                  Duplizieren
                  <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.move(path, -1)}>
                  <ArrowUpIcon />
                  Nach oben
                  <DropdownMenuShortcut>⌥↑</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => actions.move(path, 1)}>
                  <ArrowDownIcon />
                  Nach unten
                  <DropdownMenuShortcut>⌥↓</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <ShapesIcon />
                Typ ändern
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {KINDS.map((kind) => (
                  <DropdownMenuItem
                    key={kind}
                    disabled={kind === row.kind}
                    onSelect={() => actions.setKind(path, kind)}
                  >
                    <JsonTypeIcon kind={kind} />
                    {JSON_KIND_META[kind].label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {row.kind === "object" && (
              <DropdownMenuItem onSelect={() => actions.sortKeys(path)}>
                <ArrowDownAZIcon />
                Schlüssel sortieren
              </DropdownMenuItem>
            )}
            {embedded && (
              <DropdownMenuItem onSelect={() => actions.unpack(path)}>
                <PackageOpenIcon />
                Eingebettetes JSON entpacken
              </DropdownMenuItem>
            )}
            {container && !isRoot && (
              <DropdownMenuItem onSelect={() => actions.pack(path)}>
                <PackageIcon />
                Als JSON-Text einpacken
              </DropdownMenuItem>
            )}
            {!isRoot && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => actions.remove(path)}>
                  <Trash2Icon />
                  Löschen
                  <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
