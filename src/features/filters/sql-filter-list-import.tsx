import { ListPlusIcon } from "lucide-react";
import { type RefObject, useId, useMemo, useRef } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { prepareSqlFilterListImport } from "@/lib/sql-filter-list-import";

export function SqlFilterListImport({
  source,
  onSourceChange,
  initialSource,
  value,
  onImport,
  inputRef,
  disabled,
}: {
  source: string | null;
  onSourceChange: (source: string | null) => void;
  initialSource: string;
  value: string;
  onImport: (value: string) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}) {
  const id = useId();
  const openedFromButton = useRef(false);
  const restoreInput = useRef(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.filter.sql-list");
  const preview = useMemo(
    () => (source === null ? null : prepareSqlFilterListImport(source, value)),
    [source, value],
  );
  return (
    <Popover
      open={source !== null && !disabled}
      onOpenChange={(open) => {
        if (open) openedFromButton.current = true;
        onSourceChange(open ? initialSource : null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label="SQL-Liste übernehmen"
          title="SQL-Liste übernehmen"
          className="m-1 flex h-6 shrink-0 items-center gap-1 self-end rounded-md px-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
        >
          <ListPlusIcon className="size-3.5" />
          SQL
          {feature.isNew && <NewBadge />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[min(20rem,calc(100vw-1rem))] gap-3"
        onOpenAutoFocus={() => {
          restoreInput.current = !openedFromButton.current;
          openedFromButton.current = false;
        }}
        onInteractOutside={() => {
          restoreInput.current = false;
        }}
        onCloseAutoFocus={(event) => {
          const input = restoreInput.current ? inputRef?.current : null;
          restoreInput.current = false;
          if (!input?.isConnected || input.disabled) return;
          event.preventDefault();
          input.focus({ preventScroll: true });
        }}
        onKeyDown={(event) => event.stopPropagation()}
      >
        <label htmlFor={id} className="text-sm font-medium">
          SQL-Liste übernehmen
        </label>
        <Textarea
          id={id}
          value={source ?? ""}
          disabled={disabled}
          placeholder="('A', 'B', 'O''Brien')"
          aria-invalid={!!preview && !preview.ok}
          aria-describedby={`${id}-preview`}
          onChange={(event) => onSourceChange(event.target.value)}
          className="h-24 max-h-40 font-mono text-xs"
        />
        <div id={`${id}-preview`} className="flex flex-col gap-1 text-xs">
          {preview?.ok ? (
            <>
              <p role="status">
                {preview.values.length} Werte · {preview.added} neu · {preview.total} gesamt
              </p>
              {preview.values.slice(0, 5).map((item, index) => (
                <code
                  key={item}
                  data-sql-list-preview={index}
                  className="whitespace-pre-wrap break-all text-muted-foreground"
                >
                  {JSON.stringify(item.length > 120 ? `${item.slice(0, 120)}…` : item)}
                </code>
              ))}
              {preview.values.length > 5 && <span>… {preview.values.length - 5} weitere</span>}
            </>
          ) : preview ? (
            <p role="alert" className="text-destructive">
              {preview.error}
            </p>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          Übernimmt Filterwerte. Der Spaltentyp bestimmt die SQL-Literale.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => onSourceChange(null)}>
            Abbrechen
          </Button>
          <Button
            ref={feature.ref}
            type="button"
            size="sm"
            disabled={disabled || !preview?.ok || preview.added === 0}
            onClick={() => {
              if (!disabled && preview?.ok && preview.added > 0) {
                restoreInput.current = true;
                onImport(preview.encoded);
              }
            }}
          >
            Werte übernehmen
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
