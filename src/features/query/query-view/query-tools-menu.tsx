import {
  ArrowDownToLineIcon,
  ArrowUpToLineIcon,
  BinaryIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  BookmarkPlusIcon,
  BookmarkXIcon,
  BookOpenIcon,
  EraserIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GitCompareArrowsIcon,
  HistoryIcon,
  LibraryIcon,
  MoreHorizontalIcon,
  PackageSearchIcon,
  RefreshCwIcon,
  SaveAllIcon,
  SaveIcon,
  TerminalIcon,
  TextSearchIcon,
  WandSparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { type RefObject, useRef, useState } from "react";
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
import { REVIEW_SQL_FORMAT_ACTION } from "@/features/query/query-editor-pane/types";
import type { SavedConnection } from "@/lib/connections";
import { readDuckdbFilePathContext } from "@/lib/db/duckdb-path-context";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { hasNewFeatures, useSeenNewFeatures } from "@/lib/new-features";
import { effectiveConnectionString } from "@/lib/ssh";

import { EDITOR_ACTIONS } from "./constants";
import { DuckdbFilePathDialog, type DuckdbPathHelp } from "./duckdb-file-path-dialog";
import { PgvectorReferenceDialog } from "./pgvector-reference-dialog";
import type { QueryFileEncodingAction } from "./use-query-file-actions";

interface DuckdbPathScope {
  connection: SavedConnection;
  database: string | null;
  transaction: boolean;
}

async function readPathHelp(scope: DuckdbPathScope): Promise<DuckdbPathHelp> {
  if (scope.transaction) return { state: "transaction" };
  try {
    return await readDuckdbFilePathContext(
      effectiveConnectionString(scope.connection),
      scope.database ?? undefined,
    );
  } catch {
    return { state: "unknown" };
  }
}

interface QueryToolsMenuProps {
  editorApiRef: RefObject<QueryEditorApi | null>;
  shortcutLabel: (id: string) => string;
  hasSql: boolean;
  connected: boolean;
  isSql: boolean;
  pgvectorReferenceAvailable?: boolean;
  duckdbPathScope?: DuckdbPathScope;
  serverOutput: boolean;
  bookmarkCount: number;
  filePath: string | null;
  fileBusy: boolean;
  fileRequiresUtf8Copy: boolean;
  isRunning: boolean;
  onOpenHistory: () => void;
  onOpenOutput: () => void;
  onOpenSave: () => void;
  onOpenSnippets: () => void;
  onOpenTabSearch: () => void;
  onClearBookmarks: () => void;
  onFileOpen: () => void;
  onChooseFileEncoding: (action: QueryFileEncodingAction) => void;
  onFileSave: (saveAs: boolean) => void;
  onClearEditor: () => void;
}

export function QueryToolsMenu({
  editorApiRef,
  shortcutLabel,
  hasSql,
  connected,
  isSql,
  pgvectorReferenceAvailable = false,
  duckdbPathScope,
  serverOutput,
  bookmarkCount,
  filePath,
  fileBusy,
  fileRequiresUtf8Copy,
  isRunning,
  onOpenHistory,
  onOpenOutput,
  onOpenSave,
  onOpenSnippets,
  onOpenTabSearch,
  onClearBookmarks,
  onFileOpen,
  onChooseFileEncoding,
  onFileSave,
  onClearEditor,
}: QueryToolsMenuProps) {
  const packageMembers = useNewFeatureVisibility<HTMLDivElement>("query.tools.package-members");
  const fileEncoding = useNewFeatureVisibility<HTMLDivElement>("query.tools.file.encoding");
  const formatReview = useNewFeatureVisibility<HTMLDivElement>("query.tools.format-review");
  const pgvectorReference = useNewFeatureVisibility<HTMLDivElement>(
    "query.tools.pgvector-reference",
  );
  const duckdbPath = useNewFeatureVisibility<HTMLDivElement>("query.tools.duckdb-file-path");
  const trigger = useRef<HTMLButtonElement>(null);
  const pendingHelp = useRef<"pgvector" | "duckdb" | null>(null);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [duckdbHelp, setDuckdbHelp] = useState<{
    connection: SavedConnection;
    request: Promise<DuckdbPathHelp>;
  } | null>(null);
  const seen = useSeenNewFeatures();
  const fileNew = hasNewFeatures("query.tools.file", seen);
  const hiddenNewTools = [
    ...(pgvectorReference.isNew && !pgvectorReferenceAvailable
      ? ["query.tools.pgvector-reference" as const]
      : []),
    ...(duckdbPath.isNew && !duckdbPathScope ? ["query.tools.duckdb-file-path" as const] : []),
  ];
  const visibleToolsSeen = hiddenNewTools.length ? new Set([...seen, ...hiddenNewTools]) : seen;
  const toolsNew = hasNewFeatures("query.tools", visibleToolsSeen) && isSql;
  const pendingAction = useRef<string | null>(null);
  return (
    <IconMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          ref={trigger}
          data-feature="query.tools"
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
          const help = pendingHelp.current;
          pendingHelp.current = null;
          if (help === "pgvector") {
            event.preventDefault();
            setReferenceOpen(true);
            return;
          }
          if (help === "duckdb" && duckdbPathScope) {
            event.preventDefault();
            setDuckdbHelp({
              connection: duckdbPathScope.connection,
              request: readPathHelp(duckdbPathScope),
            });
            return;
          }
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
          data-hotkey="query.history"
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
                data-hotkey="query.format"
                onSelect={() => editorApiRef.current?.format()}
                disabled={!hasSql}
              />
            )}
            {isSql && (
              <IconMenuItem
                ref={formatReview.ref}
                icon={<GitCompareArrowsIcon />}
                label="Formatierung vergleichen…"
                onSelect={() => {
                  pendingAction.current = REVIEW_SQL_FORMAT_ACTION;
                }}
                disabled={!hasSql}
              >
                {formatReview.isNew && (
                  <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />
                )}
              </IconMenuItem>
            )}
            {isSql && (
              <IconMenuItem
                ref={packageMembers.ref}
                icon={<PackageSearchIcon />}
                label="Package-Funktionen suchen"
                shortcut={shortcutLabel("query.packageMembers")}
                data-hotkey="query.packageMembers"
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
            {pgvectorReferenceAvailable && (
              <IconMenuItem
                ref={pgvectorReference.ref}
                icon={<BookOpenIcon />}
                label="pgvector-Referenz…"
                onSelect={() => {
                  pendingHelp.current = "pgvector";
                }}
              >
                {pgvectorReference.isNew && (
                  <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />
                )}
              </IconMenuItem>
            )}
            {duckdbPathScope && (
              <IconMenuItem
                ref={duckdbPath.ref}
                icon={<FolderOpenIcon />}
                label="DuckDB-Dateipfade…"
                onSelect={() => {
                  pendingHelp.current = "duckdb";
                }}
              >
                {duckdbPath.isNew && (
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
              data-hotkey="query.bookmark"
              onSelect={() => editorApiRef.current?.toggleBookmark()}
            />
            <IconMenuItem
              icon={<ArrowDownToLineIcon />}
              label="Nächstes"
              shortcut={shortcutLabel("query.nextBookmark")}
              data-hotkey="query.nextBookmark"
              onSelect={() => editorApiRef.current?.gotoBookmark("next")}
              disabled={bookmarkCount === 0}
            />
            <IconMenuItem
              icon={<ArrowUpToLineIcon />}
              label="Vorheriges"
              shortcut={shortcutLabel("query.prevBookmark")}
              data-hotkey="query.prevBookmark"
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
          <IconMenuSubTrigger icon={<FileCodeIcon />} label="Datei">
            {fileNew && <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />}
          </IconMenuSubTrigger>
          <IconMenuSubContent>
            <IconMenuItem
              icon={<FolderOpenIcon />}
              label="SQL-Datei öffnen…"
              onSelect={onFileOpen}
              disabled={fileBusy}
            />
            <IconMenuItem
              ref={fileEncoding.ref}
              icon={<BinaryIcon />}
              label="SQL-Datei mit Kodierung öffnen…"
              onSelect={() => onChooseFileEncoding("open")}
              disabled={fileBusy}
            >
              {fileEncoding.isNew && (
                <NewBadge className="absolute -right-1 -top-1 px-1 text-[8px]" />
              )}
            </IconMenuItem>
            {filePath && (
              <IconMenuItem
                icon={<RefreshCwIcon />}
                label="Datei mit Kodierung neu laden…"
                onSelect={() => onChooseFileEncoding("reload")}
                disabled={fileBusy}
              />
            )}
            <IconMenuItem
              icon={<SaveIcon />}
              label={
                fileRequiresUtf8Copy
                  ? "UTF-8-Kopie speichern…"
                  : filePath
                    ? "Speichern"
                    : "Speichern unter…"
              }
              onSelect={() => onFileSave(false)}
              disabled={fileBusy || (!hasSql && !filePath)}
            />
            {filePath && !fileRequiresUtf8Copy && (
              <IconMenuItem
                icon={<SaveAllIcon />}
                label="Speichern unter…"
                onSelect={() => onFileSave(true)}
                disabled={fileBusy}
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
      {pgvectorReferenceAvailable && referenceOpen && (
        <PgvectorReferenceDialog
          onClose={() => setReferenceOpen(false)}
          onRestoreFocus={() => trigger.current?.focus()}
        />
      )}
      {duckdbHelp && duckdbPathScope?.connection === duckdbHelp.connection && (
        <DuckdbFilePathDialog
          request={duckdbHelp.request}
          onClose={() => setDuckdbHelp(null)}
          onRestoreFocus={() => trigger.current?.focus()}
        />
      )}
    </IconMenu>
  );
}
