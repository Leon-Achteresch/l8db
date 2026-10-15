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
  PackageSearchIcon,
  SaveAllIcon,
  SaveIcon,
  TerminalIcon,
  TextSearchIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { type RefObject, useRef } from "react";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuSub, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { QueryEditorApi } from "@/features/query/query-editor-pane";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useHasNewFeatures } from "@/lib/new-features";

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
  const packageMembers = useNewFeatureVisibility<HTMLDivElement>("query.tools.package-members");
  const toolsNew = useHasNewFeatures("query.tools") && isSql;
  const pendingAction = useRef<string | null>(null);
  return (
    <IconMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-sm"
          variant="ghost"
          className="relative"
          aria-label="Weitere Werkzeuge"
          title="Verlauf, Server-Ausgabe, Datei und Bearbeiten"
        >
          <MoreHorizontalIcon className="size-3.5" />
          {toolsNew && <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />}
        </Button>
      </DropdownMenuTrigger>
      <IconMenuContent
        onCloseAutoFocus={(event) => {
          const id = pendingAction.current;
          if (!id) return;
          pendingAction.current = null;
          event.preventDefault();
          editorApiRef.current?.action(id);
        }}
      >
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
          <IconMenuSubTrigger icon={<WrenchIcon />} label="Editor-Werkzeuge">
            {toolsNew && <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />}
          </IconMenuSubTrigger>
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
            {isSql && (
              <IconMenuItem
                ref={packageMembers.ref}
                icon={<PackageSearchIcon />}
                label="Package-Funktionen suchen"
                shortcut={shortcutLabel("query.packageMembers")}
                onSelect={() => {
                  pendingAction.current = "editor.action.quickOutline";
                }}
                disabled={!hasSql}
              >
                {packageMembers.isNew && (
                  <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />
                )}
              </IconMenuItem>
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
