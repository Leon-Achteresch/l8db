import { Eye } from "lucide-react";
import { useReadOnlyConnection } from "@/lib/connections";
import { cn } from "@/lib/utils";

interface Props {
  className?: string;
}

export function ReadOnlyBadge({ className }: Props) {
  const readOnly = useReadOnlyConnection();
  if (!readOnly) return null;
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-amber-500/60 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 dark:text-amber-400",
        className,
      )}
      title="Lesemodus: Schreibzugriffe sind für diese Verbindung gesperrt."
      aria-label="Verbindung im Lesemodus"
    >
      <Eye className="size-3.5" />
      Lesemodus
    </span>
  );
}
