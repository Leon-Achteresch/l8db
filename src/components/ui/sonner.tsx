import { CheckIcon, InfoIcon, LoaderIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { type CSSProperties, type MouseEvent, useRef } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { ToastDrop } from "@/components/motion/toast-drop";

const OFFSET = { top: "calc(var(--app-header-height) + 24px)" };
const WIDTH = { "--width": "min(380px, calc(100vw - 32px))" } as CSSProperties;

function dismissOnClick(event: MouseEvent<HTMLDivElement>) {
  if (event.defaultPrevented || !(event.target instanceof Element)) return;
  if (
    event.target.closest(
      'button, a, input, select, textarea, [role="button"], [role="link"], [contenteditable]:not([contenteditable="false"])',
    )
  )
    return;
  const toast = event.target.closest<HTMLElement>("[data-sonner-toast]");
  if (!toast || toast.dataset.dismissible === "false" || toast.dataset.removed === "true") return;
  const selection = window.getSelection();
  if (
    selection &&
    !selection.isCollapsed &&
    (toast.contains(selection.anchorNode) || toast.contains(selection.focusNode))
  )
    return;
  toast.querySelector<HTMLButtonElement>("[data-close-button]")?.click();
}

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const root = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={root} className="contents" onClick={dismissOnClick}>
        <Sonner
          theme={theme as ToasterProps["theme"]}
          className="l8-toaster"
          style={WIDTH}
          position="top-center"
          duration={3000}
          closeButton
          gap={8}
          offset={OFFSET}
          mobileOffset={OFFSET}
          icons={{
            success: <CheckIcon className="size-4 shrink-0" />,
            info: <InfoIcon className="size-4 shrink-0" />,
            warning: <TriangleAlertIcon className="size-4 shrink-0" />,
            error: <XIcon className="size-4 shrink-0" />,
            loading: <LoaderIcon className="size-4 shrink-0 animate-spin" />,
          }}
          toastOptions={{
            unstyled: true,
            closeButtonAriaLabel: "Benachrichtigung schließen",
            classNames: {
              toast: "l8-toast rounded-2xl",
              title: "l8-toast-title",
              description: "l8-toast-description",
              icon: "l8-toast-icon",
              actionButton: "l8-toast-action",
              cancelButton: "l8-toast-action",
              closeButton: "l8-toast-close",
              success: "l8-toast--success",
              error: "l8-toast--error",
              warning: "l8-toast--warning",
              info: "l8-toast--info",
            },
          }}
          {...props}
        />
      </div>
      <ToastDrop root={root} />
    </>
  );
};

export { Toaster };
