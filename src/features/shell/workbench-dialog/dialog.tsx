import { type ComponentProps, useContext, useEffect } from "react";
import { Dialog as ModalDialog } from "@/components/ui/dialog";
import { WorkbenchContext } from "@/lib/workbench-context";
import { setWorkbenchBusy } from "@/lib/workbench-tabs";

export function Dialog({
  busy = false,
  ...props
}: ComponentProps<typeof ModalDialog> & { busy?: boolean }) {
  const id = useContext(WorkbenchContext);
  useEffect(() => {
    if (id) setWorkbenchBusy(id, busy);
  }, [id, busy]);
  if (!id) return <ModalDialog {...props} />;
  return props.open ? props.children : null;
}
