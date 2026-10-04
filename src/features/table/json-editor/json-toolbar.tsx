import {
  ArrowDownAZIcon,
  ChevronDownIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  ChevronUpIcon,
  CodeXmlIcon,
  FileDownIcon,
  FileUpIcon,
  ListTreeIcon,
  Minimize2Icon,
  Redo2Icon,
  SearchIcon,
  Table2Icon,
  Undo2Icon,
  WandSparklesIcon,
  XIcon,
} from "lucide-react";
import type { RefObject } from "react";
import { NewBadge } from "@/components/new-badge";
import { IS_MAC } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { JsonToolButton as ToolButton } from "./json-tool-button";
import type { JsonEditorMode, JsonEditorState } from "./use-json-editor";

const MOD = IS_MAC ? "⌘" : "Ctrl+";

type Props = {
  state: JsonEditorState;
  readOnly: boolean;
  tableAvailable: boolean;
  isNew: boolean;
  searchRef: RefObject<HTMLInputElement | null>;
  onFormat: () => void;
  onMinify: () => void;
  onSortAll: () => void;
  onSaveFile: () => void;
  onLoadFile: () => void;
};

const MODES: { value: JsonEditorMode; label: string; icon: typeof ListTreeIcon }[] = [
  { value: "tree", label: "Baum", icon: ListTreeIcon },
  { value: "code", label: "Code", icon: CodeXmlIcon },
  { value: "table", label: "Tabelle", icon: Table2Icon },
];

export function JsonToolbar({
  state,
  readOnly,
  tableAvailable,
  isNew,
  searchRef,
  onFormat,
  onMinify,
  onSortAll,
  onSaveFile,
  onLoadFile,
}: Props) {
  const valid = state.parsed.ok;
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-border/70 px-2 py-1.5">
      <div className="flex items-center rounded-lg bg-muted/70 p-0.5" role="tablist">
        {MODES.map(({ value, label, icon: Icon }) => {
          const disabled = (value !== "code" && !valid) || (value === "table" && !tableAvailable);
          const active = state.mode === value;
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              disabled={disabled}
              onClick={() => state.setMode(value)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:opacity-35",
                active
                  ? "bg-background text-foreground shadow-sm ring-1 ring-border/60"
                  : "text-muted-foreground enabled:hover:text-foreground",
              )}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          );
        })}
      </div>

      {isNew && <NewBadge />}

      {state.mode === "tree" && (
        <div className="flex h-7 min-w-44 flex-1 items-center gap-1 rounded-lg border border-border/70 bg-background px-2 focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15">
          <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={state.query}
            onChange={(event) => state.setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                state.stepMatch(event.shiftKey ? -1 : 1);
              }
              if (event.key === "Escape" && state.query) {
                event.preventDefault();
                event.stopPropagation();
                state.setQuery("");
              }
            }}
            placeholder="Schlüssel oder Wert suchen…"
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/70"
          />
          {state.query && (
            <>
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {state.matches.length
                  ? `${state.matchIndex + 1}/${state.matches.length}`
                  : "0 Treffer"}
              </span>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => state.stepMatch(-1)}
                aria-label="Vorheriger Treffer"
              >
                <ChevronUpIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => state.stepMatch(1)}
                aria-label="Nächster Treffer"
              >
                <ChevronDownIcon className="size-3.5" />
              </button>
              <button
                type="button"
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                onClick={() => state.setQuery("")}
                aria-label="Suche leeren"
              >
                <XIcon className="size-3.5" />
              </button>
            </>
          )}
        </div>
      )}
      {state.mode !== "tree" && <div className="flex-1" />}

      <div className="flex items-center">
        {state.mode === "tree" && (
          <>
            <ToolButton label="Alles aufklappen" onClick={state.expandAll}>
              <ChevronsUpDownIcon />
            </ToolButton>
            <ToolButton label="Alles zuklappen" onClick={state.collapseAll}>
              <ChevronsDownUpIcon />
            </ToolButton>
            <span className="mx-1 h-4 w-px bg-border" />
          </>
        )}
        {!readOnly && (
          <>
            <ToolButton
              label="Rückgängig"
              shortcut={`${MOD}Z`}
              disabled={!state.canUndo}
              onClick={state.undo}
            >
              <Undo2Icon />
            </ToolButton>
            <ToolButton
              label="Wiederholen"
              shortcut={`⇧${MOD}Z`}
              disabled={!state.canRedo}
              onClick={state.redo}
            >
              <Redo2Icon />
            </ToolButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolButton
              label="Formatieren"
              shortcut={`⇧${MOD}F`}
              disabled={!valid}
              onClick={onFormat}
            >
              <WandSparklesIcon />
            </ToolButton>
            <ToolButton label="Minifizieren" disabled={!valid} onClick={onMinify}>
              <Minimize2Icon />
            </ToolButton>
            <ToolButton label="Alle Schlüssel sortieren" disabled={!valid} onClick={onSortAll}>
              <ArrowDownAZIcon />
            </ToolButton>
            <span className="mx-1 h-4 w-px bg-border" />
            <ToolButton label="Aus Datei laden…" onClick={onLoadFile}>
              <FileUpIcon />
            </ToolButton>
          </>
        )}
        <ToolButton label="Als .json speichern…" onClick={onSaveFile}>
          <FileDownIcon />
        </ToolButton>
      </div>
    </div>
  );
}
