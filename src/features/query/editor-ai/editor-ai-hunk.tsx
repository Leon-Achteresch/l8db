import { Check, X } from "lucide-react";
import type { HunkSnapshot } from "@/lib/ai/editor/inline-edit";

interface Props {
  hunk: HunkSnapshot;
  font: { family: string; size: number; lineHeight: number };
  onAccept: () => void;
  onReject: () => void;
}

export function EditorAiHunk({ hunk, font, onAccept, onReject }: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[26px] items-center gap-1 pl-1 text-[11px]">
        <button
          type="button"
          onClick={onAccept}
          className="inline-flex h-5 items-center gap-1 rounded-md bg-emerald-600/90 px-1.5 font-medium text-white shadow-xs transition-colors hover:bg-emerald-600"
        >
          <Check className="size-3" aria-hidden />
          Annehmen
        </button>
        <button
          type="button"
          onClick={onReject}
          className="inline-flex h-5 items-center gap-1 rounded-md bg-muted px-1.5 font-medium text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
        >
          <X className="size-3" aria-hidden />
          Ablehnen
        </button>
        <span className="ml-1 text-muted-foreground/80 tabular-nums">
          {hunk.removed.length ? `−${hunk.removed.length}` : ""}
          {hunk.removed.length && hunk.added ? " " : ""}
          {hunk.added ? `+${hunk.added}` : ""}
        </span>
      </div>
      {hunk.removed.length > 0 && (
        <pre
          title="Entfernte Zeilen"
          className="m-0 overflow-hidden bg-red-500/12 text-red-700/80 line-through decoration-red-500/40 dark:text-red-300/75"
          style={{
            fontFamily: font.family,
            fontSize: font.size,
            lineHeight: `${font.lineHeight}px`,
          }}
        >
          {hunk.removed.join("\n")}
        </pre>
      )}
    </div>
  );
}
