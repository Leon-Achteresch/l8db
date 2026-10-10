import {
  ArrowDownAZIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ClipboardIcon,
  CopyIcon,
  CopyPlusIcon,
  DatabaseIcon,
  EllipsisIcon,
  FileCodeIcon,
  KeyRoundIcon,
  ListPlusIcon,
  PackageIcon,
  PackageOpenIcon,
  PencilIcon,
  PlusIcon,
  RouteIcon,
  ShapesIcon,
  TextCursorInputIcon,
  Trash2Icon,
  WaypointsIcon,
} from "lucide-react";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { DropdownMenuSub, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { type JsonKind, type JsonRow, parseEmbeddedJson } from "@/lib/json-editor";
import { cn } from "@/lib/utils";
import { JSON_KIND_META } from "./json-type-icon";
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
    <IconMenu open={open} onOpenChange={onOpenChange} modal={false}>
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
          title={`Aktionen für ${isRoot ? "Wurzel" : String(row.key)} (${JSON_KIND_META[row.kind].label})`}
        >
          <EllipsisIcon className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <IconMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
        {!readOnly && !container && (
          <IconMenuItem
            icon={<PencilIcon />}
            label="Wert bearbeiten"
            shortcut="↵"
            onSelect={() => actions.startEdit(path, "value")}
          />
        )}
        {!readOnly && inObject && (
          <IconMenuItem
            icon={<TextCursorInputIcon />}
            label="Schlüssel umbenennen"
            shortcut="F2"
            onSelect={() => actions.startEdit(path, "key")}
          />
        )}
        <DropdownMenuSub>
          <IconMenuSubTrigger icon={<CopyIcon />} label="Kopieren als" />
          <IconMenuSubContent>
            <IconMenuItem
              icon={<ClipboardIcon />}
              label="Wert kopieren"
              shortcut="⌘C"
              onSelect={() => actions.copy(path, "value")}
            />
            {inObject && (
              <IconMenuItem
                icon={<KeyRoundIcon />}
                label="Schlüssel kopieren"
                onSelect={() => actions.copy(path, "key")}
              />
            )}
            <IconMenuItem
              icon={<RouteIcon />}
              label="JSONPath kopieren"
              shortcut="⇧⌘C"
              onSelect={() => actions.copy(path, "jsonpath")}
            />
            <IconMenuItem
              icon={<FileCodeIcon />}
              label="JavaScript-Zugriff kopieren"
              onSelect={() => actions.copy(path, "js")}
            />
            <IconMenuItem
              icon={<DatabaseIcon />}
              label="SQL-Ausdruck (-> / ->>) kopieren"
              onSelect={() => actions.copy(path, "pg")}
            />
            <IconMenuItem
              icon={<WaypointsIcon />}
              label="SQL-Pfad (#>) kopieren"
              onSelect={() => actions.copy(path, "pgpath")}
            />
          </IconMenuSubContent>
        </DropdownMenuSub>
        {container && (
          <>
            <IconMenuItem
              icon={<ChevronsUpDownIcon />}
              label="Alles darunter aufklappen"
              onSelect={() => actions.expandDeep(path, true)}
            />
            <IconMenuItem
              icon={<ChevronsDownUpIcon />}
              label="Alles darunter zuklappen"
              onSelect={() => actions.expandDeep(path, false)}
            />
          </>
        )}
        {!readOnly && (
          <>
            <IconMenuSeparator />
            {container && (
              <IconMenuItem
                icon={<PlusIcon />}
                label={row.kind === "array" ? "Element anhängen" : "Schlüssel hinzufügen"}
                shortcut="⌘↵"
                onSelect={() => actions.addChild(path)}
              />
            )}
            {!isRoot && (
              <>
                <IconMenuItem
                  icon={<ListPlusIcon />}
                  label="Danach einfügen"
                  onSelect={() => actions.insertAfter(path)}
                />
                <IconMenuItem
                  icon={<CopyPlusIcon />}
                  label="Duplizieren"
                  shortcut="⌘D"
                  onSelect={() => actions.duplicate(path)}
                />
                <IconMenuItem
                  icon={<ArrowUpIcon />}
                  label="Nach oben"
                  shortcut="⌥↑"
                  onSelect={() => actions.move(path, -1)}
                />
                <IconMenuItem
                  icon={<ArrowDownIcon />}
                  label="Nach unten"
                  shortcut="⌥↓"
                  onSelect={() => actions.move(path, 1)}
                />
              </>
            )}
            <DropdownMenuSub>
              <IconMenuSubTrigger icon={<ShapesIcon />} label="Typ ändern" />
              <IconMenuSubContent>
                {KINDS.map((kind) => {
                  const KindIcon = JSON_KIND_META[kind].icon;
                  return (
                    <IconMenuItem
                      key={kind}
                      icon={<KindIcon />}
                      label={JSON_KIND_META[kind].label}
                      disabled={kind === row.kind}
                      onSelect={() => actions.setKind(path, kind)}
                    />
                  );
                })}
              </IconMenuSubContent>
            </DropdownMenuSub>
            {row.kind === "object" && (
              <IconMenuItem
                icon={<ArrowDownAZIcon />}
                label="Schlüssel sortieren"
                onSelect={() => actions.sortKeys(path)}
              />
            )}
            {embedded && (
              <IconMenuItem
                icon={<PackageOpenIcon />}
                label="Eingebettetes JSON entpacken"
                onSelect={() => actions.unpack(path)}
              />
            )}
            {container && !isRoot && (
              <IconMenuItem
                icon={<PackageIcon />}
                label="Als JSON-Text einpacken"
                onSelect={() => actions.pack(path)}
              />
            )}
            {!isRoot && (
              <>
                <IconMenuSeparator />
                <IconMenuItem
                  icon={<Trash2Icon />}
                  label="Löschen"
                  variant="destructive"
                  shortcut="⌫"
                  onSelect={() => actions.remove(path)}
                />
              </>
            )}
          </>
        )}
      </IconMenuContent>
    </IconMenu>
  );
}
