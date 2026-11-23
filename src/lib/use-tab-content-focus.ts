import { useEffect, useRef } from "react";
import { focusRegions } from "@/lib/keyboard-nav";
import { useSplitView } from "@/lib/split-view";

const READY = '[role="grid"], [role="treegrid"], .monaco-editor textarea';
const KEEP =
  'input, textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';
const SETTLE_MS = 2000;

export function contentFocusTarget(): HTMLElement | null {
  const region = focusRegions().find((entry) => entry.dataset.focusRegion === "content");
  if (!region) return null;
  const { panes, focusedPane } = useSplitView.getState();
  const pane =
    panes.length > 1
      ? region.querySelector<HTMLElement>(`[data-drop-zone="pane:${focusedPane}"]`)
      : null;
  return pane ?? region;
}

export function shouldTakeContentFocus(active: Element | null, target: HTMLElement): boolean {
  if (!active || active === document.body || active === document.documentElement) return true;
  if (!active.isConnected || active.closest("[inert]")) return true;
  if (target.contains(active)) return false;
  if (active.closest(KEEP) || (active instanceof HTMLElement && active.isContentEditable))
    return false;
  return !active.matches(":focus-visible");
}

function readyElement(target: HTMLElement): HTMLElement | null {
  for (const element of target.querySelectorAll<HTMLElement>(READY))
    if (element.getClientRects().length > 0) return element;
  return null;
}

export function claimContentFocus(settleMs = SETTLE_MS): () => void {
  let frame = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: MutationObserver | null = null;
  let placed: HTMLElement | null = null;
  const stop = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    clearTimeout(timer);
    observer?.disconnect();
    observer = null;
  };
  const attempt = () => {
    frame = 0;
    const target = contentFocusTarget();
    if (!target) return stop();
    const active = document.activeElement;
    const free = placed
      ? active === placed || active === document.body
      : shouldTakeContentFocus(active, target);
    if (!free) return stop();
    const ready = readyElement(target);
    if (ready) {
      ready.focus({ preventScroll: true });
      return stop();
    }
    if (!placed) {
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
      placed = target;
    }
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(attempt);
    });
    observer.observe(target, { childList: true, subtree: true });
    timer = setTimeout(stop, settleMs);
  };
  frame = requestAnimationFrame(attempt);
  return stop;
}

export function useTabContentFocus(tabKey: string, settled: boolean): void {
  const previous = useRef(tabKey);
  useEffect(() => {
    if (!settled || previous.current === tabKey) return;
    previous.current = tabKey;
    return claimContentFocus();
  }, [tabKey, settled]);
}
