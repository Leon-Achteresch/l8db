import { type ComponentProps, useContext } from "react";
import { DialogTitle as ModalTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WorkbenchContext } from "@/lib/workbench-context";

export function DialogTitle({
  className,
  asChild: _asChild,
  ...props
}: ComponentProps<typeof ModalTitle>) {
  const id = useContext(WorkbenchContext);
  if (!id) return <ModalTitle className={className} asChild={_asChild} {...props} />;
  return <h2 {...props} className={cn("text-lg font-semibold tracking-tight", className)} />;
}
