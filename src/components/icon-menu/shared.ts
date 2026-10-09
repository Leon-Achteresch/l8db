import {
  createContext,
  type KeyboardEvent,
  type PointerEvent,
  type PointerEventHandler,
  useContext,
  useMemo,
} from "react";

export const ICON_MENU_SURFACE =
  "relative z-50 flex max-w-(--radix-dropdown-menu-content-available-width) flex-wrap items-center gap-0.5 rounded-[12px] border border-border/70 bg-popover p-1 text-popover-foreground shadow-(--shadow-menu) outline-none [&>[role=group]]:contents";

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

type Point = { x: number; y: number };
type Sample = Point & { t: number };

const AIM_SETTLE_MS = 160;
const AIM_SLACK = 6;
const AIM_WINDOW_MS = 80;

function side(a: Point, b: Point, p: Point) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function inTriangle(p: Point, a: Point, b: Point, c: Point) {
  const d1 = side(a, b, p);
  const d2 = side(b, c, p);
  const d3 = side(c, a, p);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

export function isAimingAt(from: Point, to: Point, rect: DOMRectReadOnly) {
  const left = rect.left - AIM_SLACK;
  const right = rect.right + AIM_SLACK;
  const top = rect.top - AIM_SLACK;
  const bottom = rect.bottom + AIM_SLACK;
  if (to.x >= left && to.x <= right && to.y >= top && to.y <= bottom) return true;
  const corners = [
    { x: left, y: top },
    { x: right, y: top },
    { x: right, y: bottom },
    { x: left, y: bottom },
  ];
  return corners.some((corner, index) => inTriangle(to, from, corner, corners[(index + 1) % 4]));
}

export type IconMenuAim = {
  track: PointerEventHandler<HTMLElement>;
  guard: PointerEventHandler<HTMLElement>;
};

export const IconMenuAimContext = createContext<IconMenuAim | null>(null);

function openSubmenu(content: Element) {
  const trigger = content.querySelector<HTMLElement>(
    "[aria-haspopup='menu'][aria-expanded='true']",
  );
  if (!trigger || trigger.closest("[data-icon-menu]") !== content) return null;
  const sub = document.getElementById(trigger.getAttribute("aria-controls") ?? "");
  return sub ? { trigger, sub } : null;
}

export function useIconMenuAimState(): IconMenuAim {
  return useMemo(() => {
    const trail: Sample[] = [];
    let timer = 0;
    let bypass = false;
    const settle = (content: Element) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const last = trail.at(-1);
        if (!last) return;
        const item = document
          .elementFromPoint(last.x, last.y)
          ?.closest<HTMLElement>("[role^='menuitem']");
        if (!item || item.closest("[data-icon-menu]") !== content) return;
        bypass = true;
        item.dispatchEvent(
          new window.PointerEvent("pointermove", {
            bubbles: true,
            clientX: last.x,
            clientY: last.y,
            pointerType: "mouse",
          }),
        );
        bypass = false;
      }, AIM_SETTLE_MS);
    };
    return {
      track(event) {
        if (event.pointerType !== "mouse") return;
        trail.push({ x: event.clientX, y: event.clientY, t: event.timeStamp });
        while (trail.length > 1 && event.timeStamp - trail[0].t > AIM_WINDOW_MS) trail.shift();
      },
      guard(event: PointerEvent<HTMLElement>) {
        if (bypass || event.pointerType !== "mouse" || !trail.length) return;
        const content = event.currentTarget.closest("[data-icon-menu]");
        const open = content && openSubmenu(content);
        if (!open || (open.trigger === event.currentTarget && event.type === "pointermove")) return;
        const point = { x: event.clientX, y: event.clientY };
        const from =
          trail.find((sample) => event.timeStamp - sample.t <= AIM_WINDOW_MS) ?? trail.at(-1);
        if (!from || !isAimingAt(from, point, open.sub.getBoundingClientRect())) return;
        event.preventDefault();
        settle(content);
      },
    };
  }, []);
}

export function useIconMenuAimHandlers<T extends HTMLElement>(
  onPointerMove?: PointerEventHandler<T>,
  onPointerLeave?: PointerEventHandler<T>,
) {
  const aim = useContext(IconMenuAimContext);
  return {
    onPointerMove: (event: PointerEvent<T>) => {
      onPointerMove?.(event);
      if (!event.defaultPrevented) aim?.guard(event);
    },
    onPointerLeave: (event: PointerEvent<T>) => {
      onPointerLeave?.(event);
      if (!event.defaultPrevented) aim?.guard(event);
    },
  };
}
