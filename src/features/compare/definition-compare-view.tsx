import { ChevronDownIcon, ChevronUpIcon, GitCompareIcon, RefreshCwIcon } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useConnectionsStore } from "@/lib/connections";
import { getFunctionDefinition, getViewDefinition } from "@/lib/db";
import { effectiveConnectionString } from "@/lib/ssh";

import { CompareSidePicker, type CompareSideSelection, EMPTY_SIDE } from "./compare-side-picker";
import { type DefinitionDiffApi, DefinitionDiffEditor } from "./definition-diff-editor";

interface SideState {
  definition: string;
  error: string | null;
  loading: boolean;
}

const IDLE_SIDE: SideState = { definition: "", error: null, loading: false };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function DefinitionCompareView() {
  const connections = useConnectionsStore((state) => state.connections);
  const [left, setLeft] = useState<CompareSideSelection>(EMPTY_SIDE);
  const [right, setRight] = useState<CompareSideSelection>(EMPTY_SIDE);
  const [leftState, setLeftState] = useState<SideState>(IDLE_SIDE);
  const [rightState, setRightState] = useState<SideState>(IDLE_SIDE);
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const diffRef = useRef<DefinitionDiffApi>(null);

  const loadDefinition = useCallback(
    async (side: CompareSideSelection): Promise<SideState> => {
      const connection = connections.find((item) => item.id === side.connectionId) ?? null;
      if (!connection || !side.schema) return IDLE_SIDE;
      const url = effectiveConnectionString(connection);
      const database = side.database ?? undefined;
      try {
        if (side.objectType === "view") {
          if (!side.objectName) return IDLE_SIDE;
          const definition = await getViewDefinition(
            connection.kind,
            url,
            side.schema,
            side.objectName,
            database,
          );
          return { definition, error: null, loading: false };
        }
        if (!side.objectOid) return IDLE_SIDE;
        const definition = await getFunctionDefinition(
          connection.kind,
          url,
          side.objectOid,
          database,
        );
        return { definition, error: null, loading: false };
      } catch (error) {
        return { definition: "", error: errorMessage(error), loading: false };
      }
    },
    [connections],
  );

  useEffect(() => {
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
    let active = true;
    setRightState((state) => ({ ...state, loading: true }));
    loadDefinition(right).then((state) => {
      if (active) setRightState(state);
    });
    return () => {
      active = false;
    };
  }, [right, loadDefinition, reloadToken]);

  const identity = (side: CompareSideSelection, state: SideState) => {
    const connection = connections.find((item) => item.id === side.connectionId);
    if (!connection) return "Kein Objekt gewählt";
    const parts = [
      connection.name,
      side.database ?? "—",
      side.schema && side.objectName ? `${side.schema}.${side.objectName}` : "—",
    ];
    return `${parts.join(" · ")}${state.loading ? " · lädt…" : ""}`;
  };

  if (connections.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Verbindung angelegt.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
      <div className="grid shrink-0 gap-3 border-b p-3 md:grid-cols-2">
        <CompareSidePicker title="Quelle" value={left} onChange={setLeft} />
        <CompareSidePicker title="Ziel" value={right} onChange={setRight} />
      </div>

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
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{identity(left, leftState)}</span>
          {leftState.error && <span className="text-destructive">{leftState.error}</span>}
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{identity(right, rightState)}</span>
          {rightState.error && <span className="text-destructive">{rightState.error}</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <DefinitionDiffEditor
          ref={diffRef}
          original={leftState.definition}
          modified={rightState.definition}
          onlyDifferences={onlyDifferences}
          onChangeCount={setChangeCount}
        />
      </div>
    </div>
  );
}
