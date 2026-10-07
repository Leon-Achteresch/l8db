import { type ComponentProps, useContext } from "react";
import { DialogContent as ModalContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { WorkbenchContext } from "@/lib/workbench-context";

export function DialogContent({
  className,
  showCloseButton: _close,
  onOpenAutoFocus: _focus,
  onCloseAutoFocus: _blur,
  onEscapeKeyDown: _escape,
  onPointerDownOutside: _outside,
  ...props
}: ComponentProps<typeof ModalContent>) {
  const id = useContext(WorkbenchContext);
  if (!id)
    return (
      <ModalContent
        className={className}
        showCloseButton={_close}
        onOpenAutoFocus={_focus}
        onCloseAutoFocus={_blur}
        onEscapeKeyDown={_escape}
        onPointerDownOutside={_outside}
        {...props}
      />
    );
  return (
    <section
      {...props}
      data-workbench-content
      className={cn(
        className
          ?.split(" ")
          .filter((value) => !/^(sm:)?max-[wh]-/.test(value))
          .join(" "),
        "relative mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col gap-5 overflow-y-auto p-6 sm:p-8",
      )}
    />
  );
}
