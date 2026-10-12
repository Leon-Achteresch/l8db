import {
  type FocusEvent,
  type FocusEventHandler,
  type KeyboardEvent,
  type KeyboardEventHandler,
  type PointerEvent,
  type PointerEventHandler,
  useMemo,
  useRef,
} from "react";
import { moveIconMenuFocus, useIconMenuAimState } from "./shared";

const TIP_DELAY_MS = 250;
const TIP_GAP = 8;

function useIconMenuTip() {
  const ref = useRef<HTMLSpanElement>(null);
  const handlers = useMemo(() => {
    let timer = 0;
    let visible = false;
    let current: HTMLElement | null = null;
    let anchors: Map<Element, string> | null = null;
    const anchor = (el: HTMLElement) =>
      `translate(${el.offsetLeft + el.offsetWidth / 2}px, ${el.offsetTop - TIP_GAP}px) translate(-50%, -100%)`;
    const anchorOf = (tip: HTMLElement, item: HTMLElement) => {
      anchors ??= new Map(
        [...(tip.parentElement?.querySelectorAll<HTMLElement>("[data-tip]") ?? [])].map((el) => [
          el,
          anchor(el),
        ]),
      );
      if (!anchors.has(item)) anchors.set(item, anchor(item));
      return anchors.get(item);
    };
    const place = (item: HTMLElement) => {
      const tip = ref.current;
      const label = tip?.firstElementChild;
      const kbd = tip?.lastElementChild;
      if (!tip || !(label instanceof HTMLElement) || !(kbd instanceof HTMLElement)) return;
      const transform = anchorOf(tip, item);
      if (!transform) return;
      label.textContent = item.dataset.tip ?? "";
      kbd.textContent = item.dataset.tipShortcut ?? "";
      kbd.hidden = !item.dataset.tipShortcut;
      tip.style.transition = visible
        ? "opacity 150ms ease-out, transform 150ms var(--ease-smooth-out)"
        : "opacity 150ms ease-out";
      tip.style.transform = transform;
      tip.style.opacity = "1";
      visible = true;
    };
    const show = (item: HTMLElement) => {
      if (item === current) return;
      current = item;
      window.clearTimeout(timer);
      if (visible) place(item);
      else timer = window.setTimeout(() => current && place(current), TIP_DELAY_MS);
    };
    const hide = () => {
      window.clearTimeout(timer);
      current = null;
      anchors = null;
      if (!visible || !ref.current) return;
      ref.current.style.opacity = "0";
      visible = false;
    };
    const itemIn = (content: HTMLElement, target: EventTarget) => {
      const item = target instanceof Element ? target.closest<HTMLElement>("[data-tip]") : null;
      return item && content.contains(item) ? item : null;
    };
    return {
      onFocus(event: FocusEvent<HTMLDivElement>) {
        const item = itemIn(event.currentTarget, event.target);
        if (item) show(item);
        else hide();
      },
      onPointerOver(event: PointerEvent<HTMLDivElement>) {
        const item = itemIn(event.currentTarget, event.target);
        if (item?.hasAttribute("data-disabled")) show(item);
      },
      onPointerLeave() {
        if (current?.hasAttribute("data-disabled")) hide();
      },
      onBlur(event: FocusEvent<HTMLDivElement>) {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
      },
    };
  }, []);
  return { ref, handlers };
}

type SurfaceHandlers = {
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onPointerMove?: PointerEventHandler<HTMLDivElement>;
  onPointerOver?: PointerEventHandler<HTMLDivElement>;
  onPointerLeave?: PointerEventHandler<HTMLDivElement>;
  onFocus?: FocusEventHandler<HTMLDivElement>;
  onBlur?: FocusEventHandler<HTMLDivElement>;
};

export function useIconMenuSurface(own: SurfaceHandlers) {
  const aim = useIconMenuAimState();
  const tip = useIconMenuTip();
  const props: Required<SurfaceHandlers> = {
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      own.onKeyDown?.(event);
      moveIconMenuFocus(event);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      own.onPointerMove?.(event);
      aim.track(event);
    },
    onPointerOver: (event: PointerEvent<HTMLDivElement>) => {
      own.onPointerOver?.(event);
      tip.handlers.onPointerOver(event);
    },
    onPointerLeave: (event: PointerEvent<HTMLDivElement>) => {
      own.onPointerLeave?.(event);
      tip.handlers.onPointerLeave();
    },
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      own.onFocus?.(event);
      tip.handlers.onFocus(event);
    },
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      own.onBlur?.(event);
      tip.handlers.onBlur(event);
    },
  };
  return { aim, tipRef: tip.ref, props };
}
