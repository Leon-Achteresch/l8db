import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { copyText } from "@/lib/clipboard";
import type { DriverSummary } from "@/lib/drivers";
import { cn } from "@/lib/utils";

export function InstallCommand({
  summary,
  className,
}: {
  summary: DriverSummary;
  className?: string;
}) {
  const command = summary.installCommand ?? summary.hint?.command;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(timer);
  }, [copied]);

  if (!command) return null;
  return (
    <div
      className={cn(
        "flex h-9 min-w-0 items-center gap-2 rounded-lg bg-muted/70 pr-1 pl-3 ring-1 ring-border/60 ring-inset",
        className,
      )}
    >
      <span aria-hidden className="font-mono text-xs text-muted-foreground select-none">
        $
      </span>
      <code title={command} className="min-w-0 flex-1 truncate font-mono text-xs">
        {command}
      </code>
      <button
        type="button"
        aria-label={copied ? "Befehl kopiert" : "Befehl kopieren"}
        onClick={() => void copyText(command).then(() => setCopied(true))}
        className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-[transform,background-color,color] duration-150 hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95"
      >
        {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
