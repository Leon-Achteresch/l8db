import { type ComponentProps, useContext } from "react";
import { DialogDescription as ModalDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WorkbenchContext } from "@/lib/workbench-context";

export function DialogDescription({
  className,
  asChild: _asChild,
  ...props
}: ComponentProps<typeof ModalDescription>) {
  const id = useContext(WorkbenchContext);
  if (!id) return <ModalDescription className={className} asChild={_asChild} {...props} />;
  return (
    <p {...props} className={cn("text-sm leading-relaxed text-muted-foreground", className)} />
  );
}
