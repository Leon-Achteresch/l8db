import { Settings2Icon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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
      <Button
        size={props.size === "lg" ? "lg" : "sm"}
        variant={props.size === "lg" ? "default" : "outline"}
        className={props.size === "lg" ? "h-12 px-8 text-base" : "h-7 text-xs"}
        onClick={() => setOpen(true)}
      >
        <Settings2Icon className="size-4" />
        {props.size === "lg" ? "Vergleich einrichten" : "Einrichten"}
      </Button>
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
