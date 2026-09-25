import { useState } from "react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MarkdownCell({
  source,
  onChange,
}: {
  source: string;
  onChange: (source: string) => void;
}) {
  const [editing, setEditing] = useState(!source.trim());
  if (editing)
    return (
      <div className="grid gap-2">
        <Textarea
          autoFocus
          aria-label="Markdown"
          className="min-h-24 font-mono text-xs"
          value={source}
          placeholder="# Überschrift, **fett**, *kursiv*, `code`, - Liste"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") setEditing(false);
          }}
        />
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="secondary"
            className="h-7 text-xs"
            onClick={() => setEditing(false)}
          >
            Fertig
          </Button>
        </div>
      </div>
    );
  return (
    <button
      type="button"
      title="Doppelklick zum Bearbeiten"
      className="block w-full cursor-text rounded-md px-1 text-left"
      onDoubleClick={() => setEditing(true)}
    >
      {source.trim() ? (
        <Markdown source={source} />
      ) : (
        <span className="text-xs text-muted-foreground">Leere Textzelle</span>
      )}
    </button>
  );
}
