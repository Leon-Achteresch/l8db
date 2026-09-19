import { BookmarkIcon, HistoryIcon, MoreHorizontalIcon, TerminalIcon } from "lucide-react";
import type { RefObject } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";

import { EDITOR_ACTIONS } from "./constants";

interface QueryToolsMenuProps {
  editorApiRef: RefObject<QueryEditorApi | null>;
  shortcutLabel: (id: string) => string;
  hasSql: boolean;
  connected: boolean;
  isSql: boolean;
  serverOutput: boolean;
  bookmarkCount: number;
  filePath: string | null;
  isRunning: boolean;
  onOpenHistory: () => void;
  onOpenOutput: () => void;
  onOpenSave: () => void;
  onOpenSnippets: () => void;
  onOpenTabSearch: () => void;
  onClearBookmarks: () => void;
  onFileOpen: () => void;
  onFileSave: (saveAs: boolean) => void;
  onClearEditor: () => void;
}

export function QueryToolsMenu({
  editorApiRef,
  shortcutLabel,
  hasSql,
  connected,
  isSql,
  serverOutput,
  bookmarkCount,
  filePath,
  isRunning,
  onOpenHistory,
  onOpenOutput,
  onOpenSave,
  onOpenSnippets,
  onOpenTabSearch,
  onClearBookmarks,
  onFileOpen,
  onFileSave,
  onClearEditor,
}: QueryToolsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Weitere Werkzeuge"
          title="Verlauf, Server-Ausgabe, Datei und Bearbeiten"
        >
          <MoreHorizontalIcon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-64 whitespace-nowrap">
        <DropdownMenuItem data-tour="query-history" onClick={onOpenHistory}>
          <HistoryIcon className="size-3.5" />
          Verlauf & Gespeichertes
          <span className="ml-auto text-[10px] text-muted-foreground">
            {shortcutLabel("query.history")}
          </span>
        </DropdownMenuItem>
        {serverOutput && (
          <DropdownMenuItem onClick={onOpenOutput} disabled={!connected}>
            <TerminalIcon className="size-3.5" />
            Server-Ausgabe öffnen
          </DropdownMenuItem>
        )}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <BookmarkIcon className="size-3.5" />
            Bibliothek
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={onOpenSave} disabled={!hasSql}>
              Query speichern…
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSnippets}>Snippets verwalten…</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Editor-Werkzeuge</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={onOpenTabSearch}>
              In Query-Tabs suchen
              <span className="ml-auto text-[10px] text-muted-foreground">Mod+Shift+F</span>
            </DropdownMenuItem>
            {isSql && (
              <DropdownMenuItem onClick={() => editorApiRef.current?.format()} disabled={!hasSql}>
                SQL formatieren
                <span className="ml-auto text-[10px] text-muted-foreground">
                  {shortcutLabel("query.format")}
                </span>
              </DropdownMenuItem>
            )}
            {EDITOR_ACTIONS.map(([id, label]) => (
              <DropdownMenuItem key={id} onClick={() => editorApiRef.current?.action(id)}>
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Lesezeichen</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={() => editorApiRef.current?.toggleBookmark()}>
              {`Setzen/entfernen (${shortcutLabel("query.bookmark")})`}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editorApiRef.current?.gotoBookmark("next")}
              disabled={bookmarkCount === 0}
            >
              {`Nächstes (${shortcutLabel("query.nextBookmark")})`}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editorApiRef.current?.gotoBookmark("previous")}
              disabled={bookmarkCount === 0}
            >
              {`Vorheriges (${shortcutLabel("query.prevBookmark")})`}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onClearBookmarks} disabled={bookmarkCount === 0}>
              Alle entfernen
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Datei</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onClick={onFileOpen}>SQL-Datei öffnen…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onFileSave(false)} disabled={!hasSql && !filePath}>
              {filePath ? "Speichern" : "Speichern unter…"}
            </DropdownMenuItem>
            {filePath && (
              <DropdownMenuItem onClick={() => onFileSave(true)}>Speichern unter…</DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={onClearEditor} disabled={isRunning}>
              Editor leeren
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
