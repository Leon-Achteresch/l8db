"use client";

import { SearchIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";
import { SelectScrollDownButton } from "./select-scroll-down-button";
import { SelectScrollUpButton } from "./select-scroll-up-button";
import { SEARCH_MIN_ITEMS, SelectClosedValueContext, SelectSearchContext } from "./shared";

export function SelectContent({
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
  const closedValue = React.useContext(SelectClosedValueContext);
  const shownChildren =
    closedValue === null
      ? children
      : React.Children.toArray(children).filter(
          (child) =>
            !React.isValidElement<{ value?: unknown }>(child) ||
            child.props.value === undefined ||
            child.props.value === closedValue,
        );
  const showSearch = searchable ?? autoSearchable;
  const contentPosition = showSearch ? "popper" : position;

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
        data-align-trigger={contentPosition === "item-aligned"}
        className={cn(
          "relative z-[110] max-h-(--radix-select-content-available-height) min-w-36 origin-(--radix-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 ease-smooth-out data-open:duration-250 data-closed:duration-150 data-[align-trigger=true]:animate-none data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-97 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-99",
          contentPosition === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          showSearch && "flex flex-col overflow-hidden",
          className,
        )}
        position={contentPosition}
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
          data-position={contentPosition}
          className={cn(
            "data-[position=popper]:h-(--radix-select-trigger-height) data-[position=popper]:w-full data-[position=popper]:min-w-(--radix-select-trigger-width)",
            showSearch && "min-h-0 flex-1",
          )}
        >
          <div className="[&:has([data-slot=select-item]:not([data-filtered]))_[data-slot=select-empty]]:hidden">
            <SelectSearchContext.Provider value={query.trim().toLowerCase()}>
              {shownChildren}
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
