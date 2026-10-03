import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  BookmarkXIcon,
  BookOpenIcon,
  EraserIcon,
  FileCodeIcon,
  FolderOpenIcon,
  HistoryIcon,
  LibraryIcon,
  MoreHorizontalIcon,
  SaveAllIcon,
  SaveIcon,
  TerminalIcon,
  TextSearchIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import type { RefObject } from "react";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { Button } from "@/components/ui/button";
import { DropdownMenuSub, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
    <IconMenu modal={false}>
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
      <IconMenuContent>
        <IconMenuItem
          data-tour="query-history"
          icon={<HistoryIcon />}
          label="Verlauf & Gespeichertes"
          shortcut={shortcutLabel("query.history")}
          onSelect={onOpenHistory}
        />
        {serverOutput && (
          <IconMenuItem
            icon={<TerminalIcon />}
            label="Server-Ausgabe öffnen"
            onSelect={onOpenOutput}
            disabled={!connected}
          />
        )}
        <IconMenuSeparator />
        <DropdownMenuSub>
          <IconMenuSubTrigger icon={<LibraryIcon />} label="Bibliothek" />
          <IconMenuSubContent>
            <IconMenuItem
              icon={<BookmarkPlusIcon />}
              label="Query speichern…"
              onSelect={onOpenSave}
              disabled={!hasSql}
            />
            <IconMenuItem
              icon={<BookOpenIcon />}
              label="Snippets verwalten…"
              onSelect={onOpenSnippets}
            />
          </IconMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <IconMenuSubTrigger icon={<WrenchIcon />} label="Editor-Werkzeuge" />
          <IconMenuSubContent>
            <IconMenuItem
              icon={<TextSearchIcon />}
              label="In Query-Tabs suchen"
              shortcut="Mod+Shift+F"
              onSelect={onOpenTabSearch}
            />
            {isSql && (
              <IconMenuItem
                icon={<WandSparklesIcon />}
                label="SQL formatieren"
                shortcut={shortcutLabel("query.format")}
                onSelect={() => editorApiRef.current?.format()}
                disabled={!hasSql}
              />
            )}
            {EDITOR_ACTIONS.map(([id, label, Icon]) => (
              <IconMenuItem
                key={id}
                icon={<Icon />}
                label={label}
                onSelect={() => editorApiRef.current?.action(id)}
              />
            ))}
          </IconMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <IconMenuSubTrigger icon={<BookmarkIcon />} label="Lesezeichen" />
          <IconMenuSubContent>
            <IconMenuItem
              icon={<BookmarkCheckIcon />}
              label="Setzen/entfernen"
              shortcut={shortcutLabel("query.bookmark")}
              onSelect={() => editorApiRef.current?.toggleBookmark()}
            />
            <IconMenuItem
              icon={<ArrowDownToLineIcon />}
              label="Nächstes"
              shortcut={shortcutLabel("query.nextBookmark")}
              onSelect={() => editorApiRef.current?.gotoBookmark("next")}
              disabled={bookmarkCount === 0}
            />
            <IconMenuItem
              icon={<ArrowUpToLineIcon />}
              label="Vorheriges"
              shortcut={shortcutLabel("query.prevBookmark")}
              onSelect={() => editorApiRef.current?.gotoBookmark("previous")}
              disabled={bookmarkCount === 0}
            />
            <IconMenuItem
              icon={<BookmarkXIcon />}
              label="Alle entfernen"
              variant="destructive"
              onSelect={onClearBookmarks}
              disabled={bookmarkCount === 0}
            />
          </IconMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <IconMenuSubTrigger icon={<FileCodeIcon />} label="Datei" />
          <IconMenuSubContent>
            <IconMenuItem
              icon={<FolderOpenIcon />}
              label="SQL-Datei öffnen…"
              onSelect={onFileOpen}
            />
            <IconMenuItem
              icon={<SaveIcon />}
              label={filePath ? "Speichern" : "Speichern unter…"}
              onSelect={() => onFileSave(false)}
              disabled={!hasSql && !filePath}
            />
            {filePath && (
              <IconMenuItem
                icon={<SaveAllIcon />}
                label="Speichern unter…"
                onSelect={() => onFileSave(true)}
              />
            )}
            <IconMenuItem
              icon={<EraserIcon />}
              label="Editor leeren"
              variant="destructive"
              onSelect={onClearEditor}
              disabled={isRunning}
            />
          </IconMenuSubContent>
        </DropdownMenuSub>
      </IconMenuContent>
    </IconMenu>
  );
}
