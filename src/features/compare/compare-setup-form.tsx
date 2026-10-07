import { Settings2Icon } from "lucide-react";

import { useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { CompareSidePicker } from "@/features/compare/compare-side-picker";
import {
  DataCompareSidePicker,
  type DataCompareSideSelection,
} from "@/features/compare/data-compare-side-picker";
import {
  COMPARE_OBJECT_LABELS,
  type CompareObjectType,
  type CompareSideSelection,
  supportedCompareObjectTypes,
} from "@/lib/compare-types";
import { providerFor } from "@/lib/connection-url";
import type { SavedConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

interface DefinitionSetup {
  mode: "definitions";
  sourceConnection: SavedConnection | null;
  left: CompareSideSelection;
  right: CompareSideSelection;
  onLeftChange: (value: CompareSideSelection) => void;
  onRightChange: (value: CompareSideSelection) => void;
}

interface DataSetup {
  mode: "data";
  sourceConnection: SavedConnection | null;
  left: DataCompareSideSelection;
  right: DataCompareSideSelection;
  onLeftChange: (value: DataCompareSideSelection) => void;
  onRightChange: (value: DataCompareSideSelection) => void;
}

export type CompareSetupProps = DefinitionSetup | DataSetup;

export function CompareSetupForm(
  initial: CompareSetupProps & { open: boolean; onOpenChange: (open: boolean) => void },
) {
  const [left, setLeft] = useState(initial.left);
  const [right, setRight] = useState(initial.right);
  const props = {
    ...initial,
    left,
    right,
    onLeftChange: (value: typeof left) => {
      setLeft(value);
      (initial.onLeftChange as (side: typeof left) => void)(value);
    },
    onRightChange: (value: typeof right) => {
      setRight(value);
      (initial.onRightChange as (side: typeof right) => void)(value);
    },
  } as CompareSetupProps;
  const types = supportedCompareObjectTypes(props.sourceConnection);
  const sourceProvider = props.sourceConnection ? providerFor(props.sourceConnection) : null;

  const setSharedType = (objectType: CompareObjectType) => {
    if (props.mode !== "definitions") return;
    props.onLeftChange({
      ...props.left,
      objectType,
      objectName: null,
      objectOid: null,
    });
    props.onRightChange({
      ...props.right,
      objectType,
      objectName: null,
      objectOid: null,
    });
  };

  return (
    <section
      aria-label="Vergleich einrichten"
      className="mx-auto flex w-full max-w-4xl flex-col gap-5 overflow-y-auto p-6 sm:p-8"
    >
      <div className="flex items-start gap-3 pr-8">
        {sourceProvider && props.sourceConnection ? (
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted ring-1 ring-border">
            <ProviderLogo
              providerId={sourceProvider.id}
              kind={props.sourceConnection.kind}
              className="size-5"
            />
          </span>
        ) : (
          <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted ring-1 ring-border">
            <Settings2Icon className="size-5 text-muted-foreground" />
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Vergleich einrichten</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Quelle ist immer die aktuelle Verbindung
            {props.sourceConnection ? ` (${props.sourceConnection.name})` : ""}. Zielverbindung
            wählen – eindeutige Schemas und gleichnamige Objekte werden automatisch ausgewählt.
          </p>
        </div>
      </div>

      {props.mode === "definitions" && types.length > 0 && (
        <div className="grid grid-cols-4 gap-1.5">
          {types.map((type) => {
            const active = props.left.objectType === type;
            return (
              <button
                key={type}
                type="button"
                disabled={types.length < 2}
                onClick={() => setSharedType(type)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border px-1.5 py-2 text-center text-[10px] leading-tight transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted/60",
                )}
              >
                <CompareObjectIcon type={type} className="size-4" />
                {COMPARE_OBJECT_LABELS[type]}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {props.mode === "definitions" ? (
          <>
            <CompareSidePicker
              title="Quelle"
              value={props.left}
              onChange={props.onLeftChange}
              lockConnection={props.sourceConnection}
              hideObjectType
            />
            <CompareSidePicker
              title="Ziel"
              value={props.right}
              onChange={props.onRightChange}
              preferredObjectName={props.left.objectName}
              hideObjectType
            />
          </>
        ) : (
          <>
            <DataCompareSidePicker
              title="Quelle"
              value={props.left}
              onChange={props.onLeftChange}
              lockConnection={props.sourceConnection}
            />
            <DataCompareSidePicker
              title="Ziel"
              value={props.right}
              onChange={props.onRightChange}
            />
          </>
        )}
      </div>

      <Button size="sm" className="w-full text-xs" onClick={() => initial.onOpenChange(false)}>
        Vergleich öffnen
      </Button>
    </section>
  );
}
