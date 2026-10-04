import { openPath, revealItemInDir } from "@tauri-apps/plugin-opener";
import { ExternalLinkIcon, FileIcon, FolderSearchIcon } from "lucide-react";
import { IconButton } from "@/components/icon-button";
import { formatBytesShort } from "@/lib/automation/format";
import { toast } from "@/lib/automation/toast";
import type { RunOutput } from "@/lib/db/automation";

interface Props {
  outputs: RunOutput[];
  stepNames: Map<string, string>;
}

function split(path: string): { name: string; dir: string } {
  const index = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return index < 0
    ? { name: path, dir: "" }
    : { name: path.slice(index + 1), dir: path.slice(0, index) };
}

async function attempt(action: () => Promise<void>) {
  try {
    await action();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error));
  }
}

export function RunOutputs({ outputs, stepNames }: Props) {
  if (outputs.length === 0)
    return (
      <p className="rounded-xl border border-dashed px-4 py-4 text-xs text-muted-foreground">
        Dieser Lauf hat keine Dateien erzeugt.
      </p>
    );

  return (
    <ul className="flex flex-col divide-y rounded-xl border">
      {outputs.map((output) => {
        const { name, dir } = split(output.path);
        return (
          <li key={`${output.stepId}-${output.path}`} className="flex items-center gap-3 px-3 py-2">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {output.format ? (
                output.format.slice(0, 4)
              ) : (
                <FileIcon aria-hidden className="size-3.5" />
              )}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-[13px] font-medium" title={output.path}>
                {name}
              </span>
              <span className="truncate text-[11px] text-muted-foreground" title={dir}>
                {[stepNames.get(output.stepId), formatBytesShort(output.bytes), dir]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </div>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Öffnen"
              onClick={() => void attempt(() => openPath(output.path))}
            >
              <ExternalLinkIcon />
            </IconButton>
            <IconButton
              size="icon-sm"
              variant="ghost"
              aria-label="Im Ordner zeigen"
              onClick={() => void attempt(() => revealItemInDir(output.path))}
            >
              <FolderSearchIcon />
            </IconButton>
          </li>
        );
      })}
    </ul>
  );
}
