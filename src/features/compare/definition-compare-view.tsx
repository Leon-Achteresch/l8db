import {
  ChevronDownIcon,
  ChevronUpIcon,
  GitCompareIcon,
  LoaderIcon,
  RefreshCwIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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

interface DefinitionCompareViewProps {
  left: CompareSideSelection;
  right: CompareSideSelection;
}

export function DefinitionCompareView({ left, right }: DefinitionCompareViewProps) {
  const connections = useConnectionsStore((state) => state.connections);
  const [leftState, setLeftState] = useState<SideState>(IDLE_SIDE);
  const [rightState, setRightState] = useState<SideState>(IDLE_SIDE);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
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
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b px-3 py-2">
        <GitCompareIcon className="size-4 text-muted-foreground" />
        <span className="text-xs text-muted-foreground">
          {changeCount === 0 ? "Keine Unterschiede" : `${changeCount} geänderte Stellen`}
        </span>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => diffRef.current?.goToChange(-1)}
          disabled={changeCount === 0}
        >
          <ChevronUpIcon className="size-3" />
          Vorherige
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={() => diffRef.current?.goToChange(1)}
          disabled={changeCount === 0}
        >
          <ChevronDownIcon className="size-3" />
          Nächste
        </Button>
        <div className="flex items-center gap-2">
          <Switch
            id="compare-only-differences"
            checked={onlyDifferences}
            onCheckedChange={setOnlyDifferences}
          />
          <Label htmlFor="compare-only-differences" className="text-xs">
            Nur Unterschiede
          </Label>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs"
          onClick={() => setReloadToken((token) => token + 1)}
        >
          <RefreshCwIcon className="size-3" />
          Neu laden
        </Button>
      </div>

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

      <div className="relative min-h-0 flex-1">
        <DefinitionDiffEditor
          ref={diffRef}
          original={leftState.definition}
          modified={rightState.definition}
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
    </div>
  );
}
