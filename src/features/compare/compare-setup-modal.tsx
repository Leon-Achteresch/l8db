import { ChevronDownIcon, Settings2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CompareObjectIcon } from "@/features/compare/compare-object-icon";
import { asWorkbenchTab } from "@/features/shell/as-workbench-tab";
import { CompareSetupForm, type CompareSetupProps } from "./compare-setup-form";

export type { CompareSetupProps } from "./compare-setup-form";

const SetupTab = asWorkbenchTab(CompareSetupForm, "Vergleich einrichten");

export function CompareSetupModal(
  props: CompareSetupProps & {
    size?: "sm" | "lg";
    defaultOpen?: boolean;
    onOpenChange?: (open: boolean) => void;
  },
) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  return (
    <>
      {props.size === "lg" ? (
        <Button onClick={() => setOpen(true)}>
          <Settings2Icon className="size-4" />
          Vergleich einrichten
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          className="h-7 max-w-64 gap-1.5 px-2 text-xs font-medium"
          title="Vergleich einrichten"
          onClick={() => setOpen(true)}
        >
          {props.mode === "definitions" && props.left.objectName ? (
            <>
              <CompareObjectIcon
                type={props.left.objectType}
                className="size-3.5 shrink-0 text-muted-foreground"
              />
              <span className="truncate font-mono">{props.left.objectName}</span>
            </>
          ) : (
            <>
              <Settings2Icon className="size-3.5" />
              Einrichten
            </>
          )}
          <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground" />
        </Button>
      )}
      <SetupTab
        {...props}
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          props.onOpenChange?.(next);
        }}
      />
    </>
  );
}
