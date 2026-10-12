import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  DiffIcon,
  EllipsisIcon,
  FileCodeIcon,
  LoaderIcon,
  RefreshCwIcon,
  SquarePenIcon,
} from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  IconMenu,
  IconMenuCheckboxItem,
  IconMenuContent,
  IconMenuItem,
} from "@/components/icon-menu";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Kbd } from "@/components/ui/kbd";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { CompareApplyDialog } from "@/features/compare/compare-apply-dialog";
import { CompareMigrationPanel } from "@/features/compare/compare-migration-panel";
import { CompareSetupModal, type CompareSetupProps } from "@/features/compare/compare-setup-modal";
import { CompareSideSummary } from "@/features/compare/compare-side-summary";
import {
  type DefinitionDiffApi,
  DefinitionDiffEditor,
  type DiffStats,
} from "@/features/compare/definition-diff-editor";
import { type MergeDraftApi, MergeDraftEditor } from "@/features/compare/merge-draft-editor";
import {
  type CompareSideSelection,
  compareLoadErrorMessage,
  loadCompareDefinition,
} from "@/lib/compare-definition";
import { useConnectionsStore } from "@/lib/connections";
import { definitionHunks, draftLineOrigins } from "@/lib/definition-merge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { createScrollSyncGroup, syncScrollGroup } from "@/lib/monaco/scroll-sync";

interface SideState {
  definition: string;
  error: string | null;
  loading: boolean;
}

const IDLE_SIDE: SideState = { definition: "", error: null, loading: false };

function sideReady(side: CompareSideSelection): boolean {
  if (!side.connectionId || !side.schema) return false;
  if (side.objectType === "routine" || side.objectType === "procedure") {
    return Boolean(side.objectOid);
  }
  return Boolean(side.objectName);
}

type DefinitionCompareViewProps = Extract<CompareSetupProps, { mode: "definitions" }> & {
  workspaceActions?: ReactNode;
  initialSetupOpen?: boolean;
  onSetupOpenChange?: (open: boolean) => void;
  draft: string | null;
  draftBase: string | null;
  sourceBase: string | null;
  onDraftChange: (value: string, sourceBaseline: string, targetBaseline: string) => void;
  onApplied: (side: "left" | "right") => void;
  onReload: () => void;
  onDiscard: () => void;
  onlyDifferences: boolean;
  onOnlyDifferencesChange: (value: boolean) => void;
  syncScroll: boolean;
  onSyncScrollChange: (value: boolean) => void;
  showDraft: boolean;
  onShowDraftChange: (value: boolean) => void;
};

export function DefinitionCompareView(props: DefinitionCompareViewProps) {
  const { left, right } = props;
  const connections = useConnectionsStore((state) => state.connections);
  const [leftState, setLeftState] = useState<SideState>(IDLE_SIDE);
  const [rightState, setRightState] = useState<SideState>(IDLE_SIDE);
  const { onlyDifferences, onOnlyDifferencesChange: setOnlyDifferences } = props;
  const [reloadToken, setReloadToken] = useState(0);
  const [transferSide, setTransferSide] = useState<"left" | "right">("left");
  const draftRef = useRef<MergeDraftApi>(null);
  const diffRef = useRef<DefinitionDiffApi>(null);
  const activeEditor = useRef<"comparison" | "draft">("comparison");
  const [diffStats, setDiffStats] = useState<DiffStats | null>(null);
  const draftFeature = useNewFeatureVisibility<HTMLButtonElement>("compare.draft-toggle");
  const [scrollSync] = useState(createScrollSyncGroup);
  scrollSync.enabled = props.syncScroll;
  const syncScrollFeature = useNewFeatureVisibility<HTMLButtonElement>("compare.scroll-sync");
  const [layout, setLayout] = useState<"inline" | "side">("side");
  const [migrationOpen, setMigrationOpen] = useState(false);
  const draft = props.draft ?? rightState.definition;
  const transferState = transferSide === "left" ? leftState : rightState;
  const transferLabel = transferSide === "left" ? "Quelle" : "Ziel";
  const sourceHunks = useMemo(
    () => definitionHunks(leftState.definition, draft),
    [leftState.definition, draft],
  );
  const targetHunks = useMemo(
    () => definitionHunks(rightState.definition, draft),
    [rightState.definition, draft],
  );
  const scrollMappings = useMemo(
    () =>
      targetHunks.map((hunk) => ({
        sourceStart: hunk.sourceStart,
        sourceEnd: hunk.sourceEnd,
        targetStart: hunk.draftStart,
        targetEnd: hunk.draftEnd,
      })),
    [targetHunks],
  );
  useEffect(() => {
    scrollSync.mappings = scrollMappings;
    if (props.syncScroll && props.showDraft) syncScrollGroup(scrollSync);
  }, [scrollSync, scrollMappings, props.syncScroll, props.showDraft]);
  const origins = useMemo(
    () => draftLineOrigins(sourceHunks, targetHunks, draft.split("\n").length),
    [sourceHunks, targetHunks, draft],
  );
  const changeLines = useMemo(
    () =>
      [...new Set([...sourceHunks, ...targetHunks].map((hunk) => hunk.draftStart + 1))].sort(
        (a, b) => a - b,
      ),
    [sourceHunks, targetHunks],
  );
  const changeDraft = (value: string) =>
    props.onDraftChange(value, leftState.definition, rightState.definition);
  const changeCount = props.showDraft ? changeLines.length : (diffStats?.changes ?? 0);
  const goToChange = (direction: 1 | -1) => {
    if (!props.showDraft || activeEditor.current === "comparison") {
      diffRef.current?.goToChange(direction);
      return;
    }
    draftRef.current?.goToChange(changeLines, direction);
  };

  const loadDefinition = useCallback(
    async (side: CompareSideSelection): Promise<SideState> => {
      const connection = connections.find((item) => item.id === side.connectionId) ?? null;
      if (!connection || !side.schema) return IDLE_SIDE;
      try {
        const definition = await loadCompareDefinition(connection, side);
        return { definition, error: null, loading: false };
      } catch (error) {
        return { definition: "", error: compareLoadErrorMessage(error), loading: false };
      }
    },
    [connections],
  );

  useEffect(() => {
    if (!sideReady(left)) {
      setLeftState(IDLE_SIDE);
      return;
    }
    let active = true;
    setLeftState((state) => ({ ...state, loading: true }));
    loadDefinition(left).then((state) => {
      if (active) setLeftState(state);
    });
    return () => {
      active = false;
    };
  }, [left, loadDefinition, reloadToken]);

  useEffect(() => {
    if (!sideReady(right)) {
      setRightState(IDLE_SIDE);
      return;
    }
    let active = true;
    setRightState((state) => ({ ...state, loading: true }));
    loadDefinition(right).then((state) => {
      if (active) setRightState(state);
    });
    return () => {
      active = false;
    };
  }, [right, loadDefinition, reloadToken]);

  if (connections.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung angelegt.</p>
      </div>
    );
  }

  const ready = sideReady(left) && sideReady(right);
  const blocked =
    !ready ||
    leftState.loading ||
    rightState.loading ||
    Boolean(leftState.error) ||
    Boolean(rightState.error);
  const status = !ready
    ? "Definitionen vergleichen"
    : leftState.loading || rightState.loading
      ? "Wird geladen…"
      : leftState.error || rightState.error
        ? "Nicht verfügbar"
        : !props.showDraft
          ? diffStats === null
            ? "Wird verglichen…"
            : diffStats.changes === 0
              ? "Keine Unterschiede"
              : `${diffStats.changes} ${diffStats.changes === 1 ? "Änderung" : "Änderungen"}`
          : leftState.definition === draft && rightState.definition === draft
            ? "Keine Unterschiede"
            : `${sourceHunks.length + targetHunks.length} Abweichungen`;
  const statusDetail =
    ready && !blocked
      ? props.showDraft
        ? `Abweichungen vom Entwurf: Quelle ${sourceHunks.length} · Ziel ${targetHunks.length}`
        : diffStats && diffStats.changes > 0
          ? `Quelle +${diffStats.removed} · Ziel +${diffStats.added}`
          : undefined
      : undefined;
  const sideBySide = props.showDraft || layout === "side";
  const reload = () => {
    props.onReload();
    setReloadToken((token) => token + 1);
  };
  const handleKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "F7" || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    event.stopPropagation();
    if (changeCount > 0) goToChange(event.shiftKey ? -1 : 1);
  };

  return (
    <div
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
      onKeyDownCapture={handleKey}
    >
      <div className="flex h-10 shrink-0 items-center gap-1 border-b px-2">
        <CompareSetupModal
          {...props}
          defaultOpen={props.initialSetupOpen}
          onOpenChange={props.onSetupOpenChange}
        />
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <span
          className="shrink-0 whitespace-nowrap text-xs text-muted-foreground tabular-nums"
          title={statusDetail}
        >
          {status}
        </span>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Vorherige Änderung"
          title="Vorherige Änderung (Umschalt+F7)"
          onClick={() => goToChange(-1)}
          disabled={changeCount === 0}
        >
          <ArrowUpIcon className="size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          aria-label="Nächste Änderung"
          title="Nächste Änderung (F7)"
          onClick={() => goToChange(1)}
          disabled={changeCount === 0}
        >
          <span className={props.showDraft ? "hidden 2xl:inline" : "hidden lg:inline"}>
            Nächste Änderung
          </span>
          <ArrowDownIcon className="size-3.5" />
          <Kbd className={props.showDraft ? "hidden 2xl:inline-flex" : "hidden lg:inline-flex"}>
            F7
          </Kbd>
        </Button>
        <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
        <Button
          ref={draftFeature.ref}
          size="sm"
          variant={props.showDraft ? "secondary" : "ghost"}
          className="h-7 gap-1.5 px-2 text-xs"
          aria-pressed={props.showDraft}
          title="Gemeinsamen Entwurf zum Zusammenführen anzeigen"
          onClick={() => props.onShowDraftChange(!props.showDraft)}
        >
          <SquarePenIcon className="size-3.5" />
          Entwurf
          {draftFeature.isNew && <NewBadge />}
        </Button>
        {props.showDraft && (
          <Button
            ref={syncScrollFeature.ref}
            size="sm"
            variant={props.syncScroll ? "secondary" : "ghost"}
            className="h-7 gap-1.5 px-2 text-xs"
            aria-pressed={props.syncScroll}
            title="Quelle, Ziel und Entwurf gemeinsam scrollen"
            onClick={() => props.onSyncScrollChange(!props.syncScroll)}
          >
            <ArrowUpDownIcon className="size-3.5" />
            Synchron scrollen
            {syncScrollFeature.isNew && <NewBadge />}
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ToggleGroup
            type="single"
            size="sm"
            variant="outline"
            spacing={0}
            value={sideBySide ? "side" : "inline"}
            disabled={props.showDraft}
            onValueChange={(value) => value && setLayout(value as "inline" | "side")}
            aria-label="Diff-Darstellung"
          >
            <ToggleGroupItem value="inline" className="h-7 px-2.5 text-xs">
              Inline
            </ToggleGroupItem>
            <ToggleGroupItem value="side" className="h-7 px-2.5 text-xs">
              Nebeneinander
            </ToggleGroupItem>
          </ToggleGroup>
          {props.workspaceActions}
          <IconMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Vergleichsoptionen"
                title="Vergleichsoptionen"
              >
                <EllipsisIcon className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent>
              <IconMenuCheckboxItem
                icon={<DiffIcon />}
                label="Nur Unterschiede"
                checked={onlyDifferences}
                onCheckedChange={setOnlyDifferences}
              />
              <IconMenuItem icon={<RefreshCwIcon />} label="Neu laden" onSelect={reload} />
            </IconMenuContent>
          </IconMenu>
          {ready && (
            <Button
              size="sm"
              className="ml-1 h-7 gap-1.5 px-2.5 text-xs"
              aria-pressed={migrationOpen}
              disabled={blocked}
              onClick={() => setMigrationOpen((open) => !open)}
            >
              <FileCodeIcon className="size-3.5" />
              Migration erzeugen
            </Button>
          )}
        </div>
      </div>

      {(sideReady(left) || sideReady(right)) && (
        <div className="grid shrink-0 grid-cols-2 divide-x border-b bg-muted/30">
          <CompareSideSummary
            label="Quelle"
            side={left}
            loading={leftState.loading}
            error={leftState.error}
          >
            <CompareApplyDialog
              connection={connections.find((item) => item.id === left.connectionId) ?? null}
              side={left}
              baseline={props.sourceBase ?? leftState.definition}
              draft={draft}
              disabled={blocked}
              targetLabel="Quelle"
              onDiscard={props.onDiscard}
              onApplied={() => {
                props.onApplied("left");
                setReloadToken((token) => token + 1);
              }}
            />
          </CompareSideSummary>
          <CompareSideSummary
            label="Ziel"
            side={right}
            loading={rightState.loading}
            error={rightState.error}
          >
            <CompareApplyDialog
              connection={connections.find((item) => item.id === right.connectionId) ?? null}
              side={right}
              baseline={props.draftBase ?? rightState.definition}
              draft={draft}
              disabled={blocked}
              targetLabel="Ziel"
              onDiscard={props.onDiscard}
              onApplied={() => {
                props.onApplied("right");
                setReloadToken((token) => token + 1);
              }}
            />
          </CompareSideSummary>
        </div>
      )}

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <CompareSetupModal {...props} size="lg" />
        </div>
      ) : (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <ResizablePanelGroup orientation="vertical" className="min-h-0 flex-1">
            <ResizablePanel id="compare-main" minSize="30%" className="flex min-h-0 flex-col">
              <div className="flex min-h-0 flex-1 flex-col">
                {props.showDraft && (
                  <div className="grid shrink-0 grid-cols-2 border-b text-xs">
                    {(["left", "right"] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-label={`${side === "left" ? "Quelle" : "Ziel"} auswählen`}
                        aria-pressed={transferSide === side}
                        className={`flex items-center gap-1.5 px-3 py-1.5 text-left hover:bg-muted ${transferSide === side ? "font-medium text-primary" : "text-muted-foreground"}`}
                        onClick={() => setTransferSide(side)}
                      >
                        <span
                          className={`size-2 shrink-0 rounded-full ${transferSide === side ? "bg-primary" : "border border-muted-foreground"}`}
                        />
                        {side === "left" ? "Quelle" : "Ziel"}
                      </button>
                    ))}
                  </div>
                )}
                <div className="min-h-0 flex-1">
                  <DefinitionDiffEditor
                    ref={diffRef}
                    original={leftState.definition}
                    modified={rightState.definition}
                    onlyDifferences={onlyDifferences}
                    onStats={setDiffStats}
                    readOnly
                    minimap
                    sideBySide={sideBySide}
                    draft={props.showDraft ? draft : undefined}
                    onDraftChange={changeDraft}
                    onSideSelect={setTransferSide}
                    onActivate={() => {
                      activeEditor.current = "comparison";
                    }}
                    scrollSync={props.showDraft ? scrollSync : undefined}
                  />
                </div>
              </div>
              {props.showDraft && (
                <>
                  <div className="relative flex h-9 shrink-0 items-center justify-center">
                    <div className="absolute inset-x-0 top-1/2 border-t" />
                    <Button
                      size="sm"
                      variant="secondary"
                      className="relative h-7 gap-1.5 border bg-background px-3 text-xs"
                      aria-label={`${transferLabel} in Entwurf übernehmen`}
                      disabled={
                        transferState.loading ||
                        Boolean(transferState.error) ||
                        transferState.definition === draft
                      }
                      onClick={() => changeDraft(transferState.definition)}
                    >
                      <ArrowDownIcon className="size-3.5" />
                      {transferLabel} in Entwurf
                    </Button>
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <div className="flex shrink-0 items-center gap-3 border-b px-3 py-1.5 text-xs">
                      <span className="font-medium">Merge-Ergebnis</span>
                      <span className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <span className="merge-origin-source size-2.5 rounded-sm" />
                          aus Quelle
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="merge-origin-target size-2.5 rounded-sm" />
                          aus Ziel
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="merge-origin-manual size-2.5 rounded-sm" />
                          eigene Änderungen
                        </span>
                      </span>
                    </div>
                    <div className="relative min-h-0 flex-1">
                      <MergeDraftEditor
                        ref={draftRef}
                        value={draft}
                        origins={origins}
                        onChange={changeDraft}
                        onActivate={() => {
                          activeEditor.current = "draft";
                        }}
                        scrollSync={scrollSync}
                      />
                    </div>
                  </div>
                </>
              )}
            </ResizablePanel>
            {migrationOpen && !blocked && (
              <>
                <ResizableHandle />
                <ResizablePanel
                  id="compare-migration"
                  defaultSize="24%"
                  minSize="10%"
                  className="flex min-h-0 flex-col"
                >
                  <CompareMigrationPanel
                    left={left}
                    right={right}
                    leftDefinition={leftState.definition}
                    rightDefinition={rightState.definition}
                    draft={props.showDraft ? draft : null}
                    onClose={() => setMigrationOpen(false)}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
          {(leftState.loading || rightState.loading) && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground">
              <LoaderIcon className="size-4 animate-spin" />
              Definitionen werden geladen…
            </div>
          )}
        </div>
      )}
    </div>
  );
}
