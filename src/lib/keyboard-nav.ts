import type { KeyboardEvent } from "react";

const FOCUSABLE =
  'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const PREFERRED = [
  '[role="grid"]',
  '[role="treegrid"]',
  '[role="tab"][aria-selected="true"]',
  ".monaco-editor textarea",
  '[data-active="true"]',
  '[aria-current="page"]',
];

export function stepIndex(
  current: number,
  length: number,
  key: string,
  orientation: "horizontal" | "vertical",
): number | null {
  if (length === 0) return null;
  const forward = orientation === "horizontal" ? "ArrowRight" : "ArrowDown";
  const backward = orientation === "horizontal" ? "ArrowLeft" : "ArrowUp";
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  if (key === forward) return current < 0 ? 0 : Math.min(current + 1, length - 1);
  if (key === backward) return current < 0 ? 0 : Math.max(current - 1, 0);
  return null;
}

export function typeAheadIndex(labels: string[], start: number, query: string): number | null {
  const wanted = query.toLowerCase();
  if (!wanted) return null;
  for (let offset = 1; offset <= labels.length; offset++) {
    const index = (start + offset) % labels.length;
    if (labels[index].trim().toLowerCase().startsWith(wanted)) return index;
  }
  return null;
}

export function nextRegionIndex(current: number, length: number, direction: 1 | -1): number {
  if (length === 0) return -1;
  if (current < 0) return direction === 1 ? 0 : length - 1;
  return (current + direction + length) % length;
}

function visible(element: HTMLElement): boolean {
  return !element.closest("[inert]") && element.getClientRects().length > 0;
}

export function focusRegions(root: ParentNode = document): HTMLElement[] {
  const all = [...root.querySelectorAll<HTMLElement>("[data-focus-region]")];
  return all.filter(
    (region) => visible(region) && !all.some((other) => other !== region && region.contains(other)),
  );
}

export function focusInto(region: HTMLElement): boolean {
  const initial = region.dataset.focusInitial?.split("|") ?? [];
  for (const selector of [...initial, ...PREFERRED]) {
    const target = region.querySelector<HTMLElement>(selector);
    if (target && visible(target)) {
      if (target.tabIndex < 0 && !target.matches(FOCUSABLE)) target.tabIndex = -1;
      target.focus();
      if (region.contains(document.activeElement)) return true;
    }
  }
  const first = [...region.querySelectorAll<HTMLElement>(FOCUSABLE)].find(visible);
  if (first) {
    first.focus();
    return true;
  }
  if (!region.hasAttribute("tabindex")) region.tabIndex = -1;
  region.focus();
  return document.activeElement === region;
}

export function cycleFocusRegion(direction: 1 | -1): string | null {
  const regions = focusRegions();
  const active = document.activeElement;
  const current = regions.findIndex((region) => active && region.contains(active));
  let index = current;
  for (let attempt = 0; attempt < regions.length; attempt++) {
    index = nextRegionIndex(index, regions.length, direction);
    const region = regions[index];
    if (focusInto(region)) return region.dataset.focusRegion ?? null;
  }
  return null;
}

export function focusRegionByName(name: string): boolean {
  const region = focusRegions().find((entry) => entry.dataset.focusRegion === name);
  return region ? focusInto(region) : false;
}

const SIDEBAR_ITEMS = '[data-sidebar="menu-button"], [data-sidebar="menu-sub-button"]';
let typed = "";
let typedAt = 0;

export function sidebarListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const target = event.target as HTMLElement;
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>(SIDEBAR_ITEMS)].filter(
    visible,
  );
  if (items.length === 0) return;
  const inInput = target.matches("input, textarea, [contenteditable='true']");
  if (inInput) {
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    items[0].focus();
    return;
  }
  const current = items.findIndex((item) => item === target || item.contains(target));
  if (current < 0) return;
  const item = items[current];
  const expanded = item.getAttribute("aria-expanded");
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    const open = event.key === "ArrowRight";
    if (expanded === (open ? "false" : "true")) {
      event.preventDefault();
      item.click();
    } else if (open && expanded === "true" && items[current + 1]) {
      event.preventDefault();
      items[current + 1].focus();
    }
    return;
  }
  const step = stepIndex(current, items.length, event.key, "vertical");
  if (step !== null) {
    event.preventDefault();
    items[step].focus();
    items[step].scrollIntoView({ block: "nearest" });
    return;
  }
  if (event.key.length === 1 && event.key !== " ") {
    const now = event.timeStamp;
    typed = now - typedAt > 700 ? event.key : typed + event.key;
    typedAt = now;
    const match = typeAheadIndex(
      items.map((entry) => entry.textContent ?? ""),
      typed.length > 1 ? current - 1 : current,
      typed,
    );
    if (match !== null) {
      event.preventDefault();
      items[match].focus();
      items[match].scrollIntoView({ block: "nearest" });
    }
  }
}

export function tabListKeyDown(event: KeyboardEvent<HTMLElement>): void {
  if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  const tabs = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')];
  const current = tabs.indexOf(event.target as HTMLElement);
  if (current < 0) return;
  const step = stepIndex(current, tabs.length, event.key, "horizontal");
  if (step === null) return;
  event.preventDefault();
  tabs[step].focus();
  tabs[step].scrollIntoView({ block: "nearest", inline: "nearest" });
}

const OVERLAY =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]';

export function installFocusRescue(): () => void {
  let frame = 0;
  let lastOutside: HTMLElement | null = null;
  const onFocusIn = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && !event.target.closest(OVERLAY))
      lastOutside = event.target;
  };
  const onFocusOut = (event: FocusEvent) => {
    if (event.relatedTarget || !(event.target instanceof HTMLElement)) return;
    const lost = event.target;
    const fromOverlay = Boolean(lost.closest(OVERLAY));
    const region = lost.closest<HTMLElement>("[data-focus-region]");
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (document.activeElement !== document.body || !document.hasFocus()) return;
      if (lost.isConnected && !fromOverlay) return;
      if (fromOverlay && lastOutside?.isConnected && visible(lastOutside)) {
        lastOutside.focus();
        return;
      }
      const target =
        region?.isConnected && visible(region)
          ? region
          : focusRegions().find((entry) => entry.dataset.focusRegion === "content");
      if (target) focusInto(target);
    });
  };
  document.addEventListener("focusin", onFocusIn);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("focusin", onFocusIn);
    document.removeEventListener("focusout", onFocusOut);
  };
}

export function focusNeighborTab(tab: HTMLElement): void {
  const list = tab.closest('[role="tablist"]');
  if (!list) return;
  const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
  const index = tabs.indexOf(tab);
  const neighbor = tabs[index + 1] ?? tabs[index - 1];
  if (!neighbor) return;
  neighbor.tabIndex = 0;
  neighbor.focus();
}
