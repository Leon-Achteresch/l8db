import { Download } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export function InstallButton({
  installing,
  disabled,
  onClick,
  className,
}: {
  installing: boolean;
  disabled: boolean;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-[transform,opacity] duration-150 hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
    >
      {installing ? <Spinner className="size-3.5" /> : <Download className="size-3.5" />}
      {installing ? "Installiert …" : "Installieren"}
    </button>
  );
}
