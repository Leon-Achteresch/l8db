import { CircleCheckIcon, CircleXIcon } from "lucide-react";
import type { BackupProbe } from "@/lib/db";

interface BackupToolStatusProps {
  probe: BackupProbe | undefined;
  onOpen: () => void;
}

export function BackupToolStatus({ probe, onOpen }: BackupToolStatusProps) {
  if (!probe?.tools.length) return null;
  return (
    <button
      type="button"
      className="flex h-9 w-full shrink-0 items-center gap-4 overflow-hidden border-t px-4 text-left text-xs hover:bg-muted/40"
      onClick={onOpen}
    >
      {probe.tools.map((tool, index) => (
        <span key={tool.name} className="flex min-w-0 items-center gap-1.5">
          {tool.path ? (
            <CircleCheckIcon className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <CircleXIcon className="size-3.5 shrink-0 text-destructive" />
          )}
          <span className="shrink-0 font-mono">
            {tool.name}
            {tool.version ? ` ${tool.version}` : ""}
          </span>
          {index === 0 && tool.path && (
            <span className="truncate font-mono text-muted-foreground">{tool.path}</span>
          )}
          {!tool.path && <span className="text-destructive">nicht gefunden</span>}
        </span>
      ))}
      {probe.serverVersion && (
        <span className="ml-auto shrink-0 text-muted-foreground tabular-nums">
          Server {probe.serverVersion}
        </span>
      )}
    </button>
  );
}
