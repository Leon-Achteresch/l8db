"use client";

import { CheckIcon, ChevronDownIcon, ChevronUpIcon, SearchIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { matchesSelectSearch } from "@/lib/select-search";
import { cn } from "@/lib/utils";

const SEARCH_MIN_ITEMS = 8;

const SelectSearchContext = React.createContext("");

function Select({ ...props }: React.ComponentProps<typeof SelectPrimitive.Root>) {
  return <SelectPrimitive.Root data-slot="select" {...props} />;
}

function SelectGroup({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Group>) {
  return (
    <SelectPrimitive.Group
      data-slot="select-group"
      className={cn(
        "scroll-my-1 p-1 [&:not(:has([data-slot=select-item]:not([data-filtered])))]:hidden",
        className,
      )}
      {...props}
    />
  );
}

function SelectValue({ ...props }: React.ComponentProps<typeof SelectPrimitive.Value>) {
  return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:min-w-0 *:data-[slot=select-value]:overflow-hidden *:data-[slot=select-value]:text-ellipsis *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  searchable,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Content> & { searchable?: boolean }) {
  const [query, setQuery] = React.useState("");
  const [autoSearchable, setAutoSearchable] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const showSearch = searchable ?? autoSearchable;

  React.useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const updateSearchVisibility = () => {
      const items = viewport.querySelectorAll("[data-slot=select-item]").length;
      setAutoSearchable(items >= SEARCH_MIN_ITEMS);
    };

    updateSearchVisibility();
    const observer = new MutationObserver(updateSearchVisibility);
    observer.observe(viewport, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [children]);

  React.useEffect(() => {
    if (!showSearch) return;
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [showSearch]);

  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-align-trigger={position === "item-aligned"}
        className={cn(
          "relative z-[110] max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          showSearch && "flex flex-col overflow-hidden",
          className,
        )}
        position={position}
        align={align}
        {...props}
      >
        {showSearch ? (
          <div className="flex shrink-0 items-center gap-2 border-b bg-popover px-2.5 py-2">
            <SearchIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (!["ArrowDown", "ArrowUp", "Enter", "Escape", "Tab"].includes(event.key))
                  event.stopPropagation();
              }}
              placeholder="Suchen…"
              autoComplete="off"
              spellCheck={false}
              className="w-full min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        ) : null}
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport
          ref={viewportRef}
          data-position={position}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            showSearch && "min-h-0 flex-1",
          )}
        >
          <div className="[&:has([data-slot=select-item]:not([data-filtered]))_[data-slot=select-empty]]:hidden">
            <SelectSearchContext.Provider value={query.trim().toLowerCase()}>
              {children}
            </SelectSearchContext.Provider>
            {showSearch && query.trim() ? (
              <p
                data-slot="select-empty"
                className="px-2 py-4 text-center text-sm text-muted-foreground"
              >
                Keine Treffer
              </p>
            ) : null}
          </div>
        </SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

function SelectLabel({ className, ...props }: React.ComponentProps<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      data-slot="select-label"
      className={cn("px-2 py-1.5 text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const query = React.useContext(SelectSearchContext);
  const filtered = !matchesSelectSearch(children, props.value, query);

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground not-data-[variant=destructive]:focus:**:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        filtered && "hidden",
        className,
      )}
      {...props}
      data-filtered={filtered ? "" : undefined}
      disabled={props.disabled || filtered}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator
      data-slot="select-separator"
      className={cn("pointer-events-none -mx-1 my-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollUpButton>) {
  return (
    <SelectPrimitive.ScrollUpButton
      data-slot="select-scroll-up-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronUpIcon />
    </SelectPrimitive.ScrollUpButton>
  );
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.ScrollDownButton>) {
  return (
    <SelectPrimitive.ScrollDownButton
      data-slot="select-scroll-down-button"
      className={cn(
        "z-10 flex cursor-default items-center justify-center bg-popover py-1 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      <ChevronDownIcon />
    </SelectPrimitive.ScrollDownButton>
  );
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
};
