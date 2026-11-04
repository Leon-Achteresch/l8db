import type { ScriptRunEntry } from "./script-result-list";

const OUTPUT_PREVIEW = 12;

function outputTone(level: string): string {
  if (level === "WARNING") return "text-amber-600 dark:text-amber-400";
  if (level === "ERROR") return "text-destructive";
  if (level === "OUTPUT" || level === "PROMPT") return "text-foreground";
  return "text-muted-foreground";
}

export function ScriptEntryOutput({ entry }: { entry: ScriptRunEntry }) {
  const output = entry.output ?? [];
  if (!output.length && !entry.feedback && !entry.note) return null;
  const hidden = output.length - OUTPUT_PREVIEW;
  return (
    <span className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-[11px] leading-4">
      {output
        .slice(0, OUTPUT_PREVIEW)
        .map((line, position) => ({ line, id: `${entry.index}.${position}` }))
        .map(({ line, id }) => (
          <span key={id} className={`block ${outputTone(line.level)}`}>
            {["OUTPUT", "PROMPT", "INFO"].includes(line.level) ? "" : `${line.level}: `}
            {line.message}
            {line.detail ? ` (${line.detail})` : ""}
          </span>
        ))}
      {hidden > 0 && (
        <span className="block text-muted-foreground">
          … {hidden} weitere Zeilen im Protokoll und in der Server-Ausgabe
        </span>
      )}
      {entry.feedback && <span className="block text-muted-foreground">{entry.feedback}</span>}
      {entry.note && <span className="block text-muted-foreground">{entry.note}</span>}
    </span>
  );
}
