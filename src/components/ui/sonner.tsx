import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  XIcon,
  LoaderIcon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="bottom-right"
      gap={8}
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
          success: "l8-toast--success",
          error: "l8-toast--error",
          warning: "l8-toast--warning",
          info: "l8-toast--info",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
