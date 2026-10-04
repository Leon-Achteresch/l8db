import { BracesIcon } from "lucide-react";
import {
  type ChangeEvent,
  type ComponentProps,
  type KeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { useStepForm } from "./step-form-context";

type Field = HTMLInputElement | HTMLTextAreaElement;

interface Props extends Omit<ComponentProps<"input">, "value" | "onChange" | "ref" | "children"> {
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  rows?: number;
  mono?: boolean;
}

const OPEN = /(^|[^$])\$\{([A-Za-z0-9_.:+-]*)$/;

export function TemplateInput({
  value,
  onChange,
  multiline,
  rows = 3,
  mono,
  className,
  ...rest
}: Props) {
  const { suggestions } = useStepForm();
  const listId = useId();
  const ref = useRef<Field | null>(null);
  const [query, setQuery] = useState<{ text: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!query) return [];
    const needle = query.text.toLowerCase();
    const scored = suggestions
      .filter((entry) => entry.name.toLowerCase().includes(needle))
      .sort(
        (a, b) =>
          Number(!a.name.toLowerCase().startsWith(needle)) -
          Number(!b.name.toLowerCase().startsWith(needle)),
      );
    return scored.slice(0, 8);
  }, [query, suggestions]);
  const open = matches.length > 0;

  const detect = (field: Field) => {
    const caret = field.selectionStart ?? field.value.length;
    const match = OPEN.exec(field.value.slice(0, caret));
    if (!match) {
      setQuery(null);
      return;
    }
    setQuery({ text: match[2], start: caret - match[2].length - 2 });
    setActive(0);
  };

  const insert = (name: string) => {
    const field = ref.current;
    if (!field || !query) return;
    const caret = field.selectionStart ?? value.length;
    const after = value.slice(caret).replace(/^[A-Za-z0-9_.:+-]*\}?/, "");
    const next = `${value.slice(0, query.start)}\${${name}}${after}`;
    const position = query.start + name.length + 3;
    onChange(next);
    setQuery(null);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(position, position);
    });
  };

  const openList = () => {
    const field = ref.current;
    if (!field) return;
    const caret = field.selectionStart ?? value.length;
    const next = `${value.slice(0, caret)}\${${value.slice(caret)}`;
    onChange(next);
    setQuery({ text: "", start: caret });
    setActive(0);
    requestAnimationFrame(() => {
      field.focus();
      field.setSelectionRange(caret + 2, caret + 2);
    });
  };

  const onKeyDown = (event: KeyboardEvent<Field>) => {
    if (!open) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((index) => (index + step + matches.length) % matches.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insert(matches[active].name);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setQuery(null);
    }
  };

  const shared = {
    ...rest,
    value,
    role: "combobox",
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open ? `${listId}-${active}` : undefined,
    spellCheck: false,
    onChange: (event: ChangeEvent<Field>) => {
      onChange(event.target.value);
      detect(event.target);
    },
    onKeyDown,
    onBlur: () => setQuery(null),
    className: cn(
      "w-full min-w-0 rounded-lg border border-input bg-transparent pr-9 pl-2.5 text-sm transition-[border-color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30",
      multiline ? "resize-y py-2 leading-relaxed" : "h-[calc(2.25rem+var(--ui-density-step))]",
      mono && "font-mono text-[13px]",
      className,
    ),
  };

  return (
    <Popover open={open} onOpenChange={(next) => !next && setQuery(null)}>
      <PopoverAnchor asChild>
        <div className="relative min-w-0">
          {multiline ? (
            <textarea
              {...(shared as ComponentProps<"textarea">)}
              ref={(node) => {
                ref.current = node;
              }}
              rows={rows}
            />
          ) : (
            <input
              {...shared}
              ref={(node) => {
                ref.current = node;
              }}
            />
          )}
          <button
            type="button"
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openList}
            aria-label="Platzhalter einfügen"
            title="Platzhalter einfügen"
            className={cn(
              "absolute right-1 grid size-7 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
              multiline ? "top-1" : "top-1/2 -translate-y-1/2",
            )}
          >
            <BracesIcon className="size-3.5" />
          </button>
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-80 p-1"
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div id={listId} role="listbox" aria-label="Platzhalter" className="flex flex-col">
          {matches.map((entry, index) => (
            <div
              key={entry.name}
              id={`${listId}-${index}`}
              role="option"
              tabIndex={-1}
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => insert(entry.name)}
              onKeyDown={() => undefined}
              className={cn(
                "flex cursor-pointer flex-col gap-0.5 rounded-md px-2 py-1.5",
                index === active && "bg-accent",
              )}
            >
              <span className="flex items-baseline justify-between gap-3">
                <span className="truncate font-mono text-xs text-foreground">{`\${${entry.name}}`}</span>
                {entry.example && (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">
                    {entry.example}
                  </span>
                )}
              </span>
              <span className="truncate text-xs text-muted-foreground">{entry.description}</span>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
