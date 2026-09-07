import { RegexIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  describeRegexError,
  escapeRegexLiteral,
  REGEX_PATTERN_LIBRARY,
  type RegexCompileError,
} from "@/lib/regex-search";
import { cn } from "@/lib/utils";

interface RegexSearchHelperProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  query: string;
  onQueryChange: (query: string) => void;
  onInsert: (snippet: string) => void;
  error: RegexCompileError | null;
  matchCount: number;
  className?: string;
}

export function RegexSearchHelper({
  enabled,
  onEnabledChange,
  query,
  onQueryChange,
  onInsert,
  error,
  matchCount,
  className,
}: RegexSearchHelperProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
      <button
        type="button"
        title="Regulären Ausdruck verwenden"
        aria-pressed={enabled}
        onClick={() => onEnabledChange(!enabled)}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded cursor-pointer hover:bg-accent",
          enabled && "bg-primary/15 text-primary",
        )}
      >
        <RegexIcon className="size-3.5" />
      </button>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            title="Regex-Hilfe und Musterbibliothek"
            disabled={!enabled}
            className="inline-flex h-6 shrink-0 items-center justify-center rounded px-1.5 font-mono text-[11px] cursor-pointer hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
          >
            .*
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="flex items-center gap-2 border-b border-border px-3 py-2">
            <span className="text-xs font-medium">Muster einfügen</span>
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {error ? "—" : `${matchCount} Treffer`}
            </span>
          </div>
          {error && (
            <p className="border-b border-border px-3 py-2 text-[11px] text-destructive">
              {describeRegexError(error)}
            </p>
          )}
          <ScrollArea className="h-64">
            <ul className="flex flex-col p-1">
              {REGEX_PATTERN_LIBRARY.map((template) => (
                <li key={template.id}>
                  <button
                    type="button"
                    onClick={() => onInsert(template.pattern)}
                    className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left hover:bg-accent cursor-pointer"
                  >
                    <span className="flex w-full items-center gap-2">
                      <span className="text-xs font-medium">{template.label}</span>
                      <code className="ml-auto truncate rounded bg-muted px-1 font-mono text-[11px]">
                        {template.pattern}
                      </code>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {template.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
          <div className="border-t border-border p-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-full text-xs"
              disabled={query.trim() === ""}
              onClick={() => onQueryChange(escapeRegexLiteral(query))}
            >
              Suchtext escapen
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
