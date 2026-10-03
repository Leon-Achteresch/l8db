import { createContext, type KeyboardEvent } from "react";

export const IconMenuCloseContext = createContext<(() => void) | null>(null);

export const ICON_MENU_SURFACE =
  "z-50 flex max-w-(--radix-dropdown-menu-content-available-width) flex-wrap items-center gap-0.5 rounded-[12px] border border-border/70 bg-popover p-1 text-popover-foreground outline-none";

export const ICON_MENU_ITEM =
  "relative grid size-8 shrink-0 cursor-default place-items-center rounded-lg text-muted-foreground outline-hidden select-none transition-[background-color,color,scale] duration-150 ease-out focus:bg-accent focus:text-accent-foreground active:scale-90 aria-checked:bg-primary/12 aria-checked:text-primary aria-expanded:bg-accent aria-expanded:text-accent-foreground data-disabled:opacity-35 data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive dark:data-[variant=destructive]:focus:bg-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

export function moveIconMenuFocus(event: KeyboardEvent<HTMLDivElement>) {
  const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
  const content = event.currentTarget;
  if (!step || event.defaultPrevented || !content.contains(event.target as Node)) return;
  const items = [
    ...content.querySelectorAll<HTMLElement>("[role^='menuitem']:not([data-disabled])"),
  ];
  const next = items[items.indexOf(document.activeElement as HTMLElement) + step];
  if (!next) return;
  event.preventDefault();
  next.focus();
}
