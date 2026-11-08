import { anchorFeatureOf } from "../usage";

export const HOVER_DELAY_MS = 600;
export const BLOCKING_OVERLAYS =
  '[role="tooltip"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

export interface TooltipTarget {
  id: string;
  element: Element;
}

export interface VideoTooltipOptions {
  hasClip: (id: string) => boolean;
  blocked: () => boolean;
  onChange: (target: TooltipTarget | null) => void;
  delay?: number;
}

export interface VideoTooltipController {
  enter: (element: Element) => void;
  hide: () => void;
  press: () => void;
  release: () => void;
  pending: () => TooltipTarget | null;
  shown: () => TooltipTarget | null;
}

export function createVideoTooltipController({
  hasClip,
  blocked,
  onChange,
  delay = HOVER_DELAY_MS,
}: VideoTooltipOptions): VideoTooltipController {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: TooltipTarget | null = null;
  let shown: TooltipTarget | null = null;
  let pressed = false;
  const cancel = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  const hide = () => {
    cancel();
    if (!shown) return;
    shown = null;
    onChange(null);
  };
  return {
    enter: (element) => {
      if (shown?.element === element || pending?.element === element) return;
      hide();
      const id = element.getAttribute("data-feature");
      if (pressed || !id || !hasClip(id)) return;
      pending = { id, element };
      timer = setTimeout(() => {
        const target = pending;
        timer = undefined;
        pending = null;
        if (!target || pressed || !target.element.isConnected || blocked()) return;
        shown = target;
        onChange(target);
      }, delay);
    },
    hide,
    press: () => {
      pressed = true;
      hide();
    },
    release: () => {
      pressed = false;
    },
    pending: () => pending,
    shown: () => shown,
  };
}

function anchorOf(target: EventTarget | null): Element | null {
  const id = anchorFeatureOf(target);
  return id ? (target as Element).closest("[data-feature]") : null;
}

export function installVideoTooltips(
  controller: VideoTooltipController,
  root: Pick<Document, "addEventListener" | "removeEventListener"> = document,
  win: Pick<Window, "addEventListener" | "removeEventListener"> = window,
): () => void {
  const over = (event: Event) => {
    const anchor = anchorOf(event.target);
    if (anchor) controller.enter(anchor);
    else controller.hide();
  };
  const out = (event: Event) => {
    if (!(event as PointerEvent).relatedTarget) controller.hide();
  };
  const focusOut = () => controller.hide();
  const key = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape" || (event as KeyboardEvent).key === "Tab")
      controller.hide();
  };
  const press = () => controller.press();
  const release = () => controller.release();
  const hide = () => controller.hide();
  const options = { capture: true, passive: true };
  const listeners: [string, (event: Event) => void][] = [
    ["pointerover", over],
    ["pointerout", out],
    ["focusin", over],
    ["focusout", focusOut],
    ["keydown", key],
    ["pointerdown", press],
    ["pointerup", release],
    ["pointercancel", release],
    ["wheel", hide],
  ];
  for (const [type, listener] of listeners) root.addEventListener(type, listener, options);
  win.addEventListener("blur", hide);
  return () => {
    controller.hide();
    for (const [type, listener] of listeners) root.removeEventListener(type, listener, options);
    win.removeEventListener("blur", hide);
  };
}
