import { CheckIcon, InfoIcon, LoaderIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { useTheme } from "next-themes";
import { type CSSProperties, useRef } from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { ToastDrop } from "@/components/motion/toast-drop";

const OFFSET = { top: "calc(var(--app-header-height) + 10px)" };
const WIDTH = { "--width": "400px" } as CSSProperties;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();
  const root = useRef<HTMLDivElement>(null);

  return (
    <>
      <div ref={root} className="contents">
        <Sonner
          theme={theme as ToasterProps["theme"]}
          className="l8-toaster"
          style={WIDTH}
          position="top-center"
          duration={5500}
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
            classNames: {
              toast: "l8-toast",
              title: "l8-toast-title",
              description: "l8-toast-description",
              icon: "l8-toast-icon",
              actionButton: "l8-toast-action",
              cancelButton: "l8-toast-action",
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
