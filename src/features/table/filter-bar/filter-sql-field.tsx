import { Maximize2Icon, PlayIcon } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { IS_MAC } from "@/lib/platform";

const SqlEditor = lazy(() =>
  import("@/features/table/sql-editor").then((module) => ({ default: module.SqlEditor })),
);

export function FilterSqlField({
  value,
  json,
  columns,
  label,
  dirty,
  onChange,
  onSubmit,
  onAi,
}: {
  value: string;
  json: boolean;
  columns: string[];
  label: string;
  dirty: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onAi?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const multiline = value.includes("\n");
  const placeholder = json
    ? '{"status": "error"}'
    : `status = 'error' AND tokens > 4000${onAi ? " – oder in eigenen Worten für die KI" : ""}`;
  const submitExpanded = () => {
    setExpanded(false);
    onSubmit();
  };
  return (
    <div className="flex min-w-48 flex-1 items-center gap-1">
      {multiline ? (
        <button
          type="button"
          title={value}
          aria-label={`Mehrzeiligen ${label}-Filter bearbeiten`}
          onClick={() => setExpanded(true)}
          className="h-7 min-w-0 flex-1 truncate rounded px-1 text-left font-mono text-xs outline-none hover:bg-muted/50 focus-visible:bg-muted/50"
        >
          {value.replace(/\s+/g, " ")}
        </button>
      ) : json ? (
        <input
          aria-label={`${label}-Filter`}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if ((event.metaKey || event.ctrlKey) && onAi) onAi();
            else onSubmit();
          }}
          className="h-7 min-w-0 flex-1 bg-transparent px-1 font-mono text-xs outline-none placeholder:text-muted-foreground"
        />
      ) : (
        <Suspense fallback={<div className="h-7 min-w-0 flex-1" />}>
          <div className="min-w-0 flex-1" data-filter-sql>
            <SqlEditor
              singleLine
              value={value}
              onChange={(next) => {
                onChange(next);
                if (next.includes("\n")) setExpanded(true);
              }}
              onSubmit={onSubmit}
              onModSubmit={onAi}
              columns={columns}
              placeholder={placeholder}
              className="h-7 rounded-none border-0 bg-transparent py-0 shadow-none focus-within:ring-0 dark:bg-transparent"
            />
          </div>
        </Suspense>
      )}
      {dirty && !multiline ? (
        <span className="hidden shrink-0 items-center gap-1 text-[11px] text-muted-foreground sm:flex">
          <Kbd>↵</Kbd>
          anwenden
        </span>
      ) : null}
      <Popover open={expanded} onOpenChange={setExpanded}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="Im großen Editor bearbeiten"
            title="Im großen Editor bearbeiten"
          >
            <Maximize2Icon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(40rem,calc(100vw-2rem))] gap-2 p-2">
          {json ? (
            <Textarea
              aria-label={`${label}-Filter bearbeiten`}
              value={value}
              autoFocus
              spellCheck={false}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  submitExpanded();
                }
              }}
              className="h-40 font-mono text-xs"
            />
          ) : (
            <Suspense fallback={<div className="h-40" role="status" />}>
              <SqlEditor
                value={value}
                onChange={onChange}
                onSubmit={submitExpanded}
                columns={columns}
                placeholder={placeholder}
                autoFocus
                className="h-40"
              />
            </Suspense>
          )}
          <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Kbd>{IS_MAC ? "⌘↵" : "Strg+↵"}</Kbd>
              anwenden
            </span>
            <Button type="button" size="xs" onClick={submitExpanded}>
              <PlayIcon />
              Anwenden
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
