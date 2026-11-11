import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PatchFile } from "@/lib/versioning/commit-patch";

const PAGE = 1500;

export function VersioningPatchView({ file }: { file: PatchFile }) {
  const [limit, setLimit] = useState(PAGE);
  if (file.binary)
    return <p className="px-4 py-3 text-xs text-muted-foreground">Binärdatei geändert</p>;
  if (!file.lines.length)
    return <p className="px-4 py-3 text-xs text-muted-foreground">Nur umbenannt</p>;
  return (
    <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background/60 font-mono text-[11px] leading-[18px]">
      <table className="w-full border-collapse">
        <tbody>
          {file.lines.slice(0, limit).map((line, index) =>
            line.kind === "hunk" ? (
              <tr key={index} className="bg-muted/50 text-muted-foreground">
                <td colSpan={3} className="px-3 py-0.5 select-none">
                  {line.text}
                </td>
              </tr>
            ) : (
              <tr
                key={index}
                className={cn(
                  line.kind === "add" && "bg-emerald-500/10",
                  line.kind === "del" && "bg-red-500/10",
                  line.kind === "note" && "text-muted-foreground italic",
                )}
              >
                <td className="w-10 pr-2 text-right text-muted-foreground/60 tabular-nums select-none">
                  {line.old}
                </td>
                <td className="w-10 pr-2 text-right text-muted-foreground/60 tabular-nums select-none">
                  {line.new}
                </td>
                <td className="pr-4 whitespace-pre">
                  <span
                    className={cn(
                      "inline-block w-4 select-none",
                      line.kind === "add" && "text-emerald-600 dark:text-emerald-400",
                      line.kind === "del" && "text-red-600 dark:text-red-400",
                    )}
                  >
                    {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
                  </span>
                  {line.text}
                </td>
              </tr>
            ),
          )}
        </tbody>
      </table>
      {file.lines.length > limit && (
        <div className="px-3 py-2 font-sans">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-full text-xs"
            onClick={() => setLimit((current) => current + PAGE)}
          >
            {file.lines.length - limit} weitere Zeilen
          </Button>
        </div>
      )}
    </div>
  );
}
