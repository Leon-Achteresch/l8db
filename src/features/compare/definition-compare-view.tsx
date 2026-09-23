import {
  ChevronDownIcon,
  ChevronUpIcon,
  EllipsisIcon,
  GitCompareIcon,
  LoaderIcon,
  RefreshCwIcon,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CompareApplyDialog } from "@/features/compare/compare-apply-dialog";
import { CompareSetupModal, type CompareSetupProps } from "@/features/compare/compare-setup-modal";
import { CompareSideSummary } from "@/features/compare/compare-side-summary";
import {
  type DefinitionDiffApi,
  DefinitionDiffEditor,
  type DiffStats,
} from "@/features/compare/definition-diff-editor";
import {
  type CompareSideSelection,
  compareLoadErrorMessage,
  loadCompareDefinition,
} from "@/lib/compare-definition";
import { useConnectionsStore } from "@/lib/connections";

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
  draft: string | null;
  draftBase: string | null;
  onDraftChange: (value: string, baseline: string) => void;
  onApplied: () => void;
  onlyDifferences: boolean;
  onOnlyDifferencesChange: (value: boolean) => void;
};

export function DefinitionCompareView(props: DefinitionCompareViewProps) {
  const { left, right } = props;
  const connections = useConnectionsStore((state) => state.connections);
  const [leftState, setLeftState] = useState<SideState>(IDLE_SIDE);
  const [rightState, setRightState] = useState<SideState>(IDLE_SIDE);
  const { onlyDifferences, onOnlyDifferencesChange: setOnlyDifferences } = props;
  const [stats, setStats] = useState<DiffStats>({ changes: 0, added: 0, removed: 0 });
  const changeCount = stats.changes;
  const [reloadToken, setReloadToken] = useState(0);
  const diffRef = useRef<DefinitionDiffApi>(null);

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

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-2">
        <GitCompareIcon className="size-4 text-muted-foreground" />
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          {!sideReady(left) || !sideReady(right)
            ? "Definitionen vergleichen"
            : leftState.loading || rightState.loading
              ? "Wird geladen…"
              : leftState.error || rightState.error
                ? "Vergleich nicht verfügbar"
                : changeCount === 0
                  ? "Keine Unterschiede"
                  : `${changeCount} geänderte ${changeCount === 1 ? "Stelle" : "Stellen"}`}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          aria-label="Vorherige Änderung"
          title="Vorherige Änderung"
          onClick={() => diffRef.current?.goToChange(-1)}
          disabled={changeCount === 0}
        >
          <ChevronUpIcon className="size-3" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0"
          aria-label="Nächste Änderung"
          title="Nächste Änderung"
          onClick={() => diffRef.current?.goToChange(1)}
          disabled={changeCount === 0}
        >
          <ChevronDownIcon className="size-3" />
        </Button>
        <div className="ml-auto flex items-center gap-1">
          {props.workspaceActions}
          <DropdownMenu>
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
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuCheckboxItem
                checked={onlyDifferences}
                onCheckedChange={setOnlyDifferences}
              >
                Nur Unterschiede
              </DropdownMenuCheckboxItem>
              <DropdownMenuItem onSelect={() => setReloadToken((token) => token + 1)}>
                <RefreshCwIcon className="size-3.5" />
                Neu laden
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <p className="px-2 py-2 text-xs leading-relaxed text-muted-foreground">
                Mit den Pfeilen im Editor Änderungen ins Ziel übernehmen. Rechts den Entwurf
                bearbeiten; Strg/Cmd+Z macht Änderungen rückgängig.
              </p>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <CompareSetupModal {...props} />
        <CompareApplyDialog
          connection={connections.find((item) => item.id === right.connectionId) ?? null}
          side={right}
          baseline={props.draftBase ?? rightState.definition}
          draft={props.draft}
          disabled={!sideReady(right) || rightState.loading || Boolean(rightState.error)}
          onApplied={() => {
            props.onApplied();
            setReloadToken((token) => token + 1);
          }}
        />
      </div>

      {(sideReady(left) || sideReady(right)) && (
        <div className="grid shrink-0 grid-cols-2 gap-3 border-b px-3 py-2 text-xs">
          <CompareSideSummary
            side={left}
            loading={leftState.loading}
            error={leftState.error}
            delta={{ sign: "-", count: stats.removed }}
          />
          <CompareSideSummary
            side={right}
            loading={rightState.loading}
            error={rightState.error}
            delta={{ sign: "+", count: stats.added }}
          />
        </div>
      )}

      {!sideReady(left) || !sideReady(right) ? (
        <div className="flex flex-1 items-center justify-center">
          <CompareSetupModal {...props} size="lg" />
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <DefinitionDiffEditor
            ref={diffRef}
            original={leftState.definition}
            modified={props.draft ?? rightState.definition}
            onModifiedChange={(value) => props.onDraftChange(value, rightState.definition)}
            onlyDifferences={onlyDifferences}
            onStats={setStats}
          />
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
