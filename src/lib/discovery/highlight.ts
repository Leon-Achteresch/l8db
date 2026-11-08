import { toast } from "sonner";
import { create } from "zustand";
import { featureSelector } from "./anchors";
import { featureAnchorId, featureById } from "./catalog";
import { releaseSurface, requestSurface } from "./coordinator";

export const ANCHOR_TIMEOUT_MS = 4000;
const HIDDEN_ANCESTOR = '[hidden], [aria-hidden="true"], [inert]';

export type HighlightOutcome = "shown" | "hidden" | "missing" | "aborted" | "unknown";

export interface HighlightTarget {
  id: string;
  title: string;
  element: HTMLElement;
  path: string | null;
}

export interface HighlightNavigator {
  navigate: (href: string) => unknown;
  href: () => string;
}

interface HighlightState {
  target: HighlightTarget | null;
}

export const useHighlightStore = create<HighlightState>()(() => ({ target: null }));

let navigator: HighlightNavigator | null = null;
let pending: { controller: AbortController; path: string | null } | null = null;

export function setHighlightNavigator(next: HighlightNavigator | null): () => void {
  navigator = next;
  return () => {
    if (navigator === next) navigator = null;
  };
}

export function findAnchor(id: string, root: ParentNode = document): HTMLElement | null {
  const matches = root.querySelectorAll<HTMLElement>(featureSelector(id));
  for (const element of matches) if (isAnchorVisible(element)) return element;
  return matches[0] ?? null;
}

export function isAnchorVisible(element: HTMLElement): boolean {
  if (!element.isConnected) return false;
  if (element.closest(HIDDEN_ANCESTOR)) return false;
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 && element.getClientRects().length > 0;
}

export function waitForAnchor(
  id: string,
  {
    signal,
    timeoutMs = ANCHOR_TIMEOUT_MS,
    root = document,
  }: { signal?: AbortSignal; timeoutMs?: number; root?: ParentNode } = {},
): Promise<HTMLElement | null> {
  const found = findAnchor(id, root);
  if (found || signal?.aborted) return Promise.resolve(signal?.aborted ? null : found);
  return new Promise((resolve) => {
    let observer: MutationObserver | null = null;
    let frame = 0;
    const finish = (element: HTMLElement | null) => {
      clearTimeout(timer);
      observer?.disconnect();
      if (frame) cancelAnimationFrame(frame);
      signal?.removeEventListener("abort", abort);
      resolve(element);
    };
    const check = () => {
      frame = 0;
      const element = findAnchor(id, root);
      if (element) finish(element);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    const abort = () => finish(null);
    const timer = setTimeout(() => finish(findAnchor(id, root)), timeoutMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (typeof MutationObserver === "function") {
      observer = new MutationObserver(schedule);
      observer.observe(root as Node, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-feature", "hidden", "data-state", "aria-hidden"],
      });
    }
  });
}

function routePath(route: string | undefined): string | null {
  return route ? route.split("?")[0] : null;
}

function needsNavigation(route: string, href: string): boolean {
  return route.includes("?") ? href !== route : href.split("?")[0] !== route;
}

export function cancelHighlight(): void {
  pending?.controller.abort();
  pending = null;
}

export function clearHighlight(): void {
  const { target } = useHighlightStore.getState();
  if (!target) return;
  useHighlightStore.setState({ target: null });
  releaseSurface("spotlight", target.id);
}

export function onHighlightLocation(pathname: string): void {
  if (pending?.path && pending.path !== pathname) cancelHighlight();
  const { target } = useHighlightStore.getState();
  if (target?.path && target.path !== pathname) clearHighlight();
}

export async function highlightFeature(
  id: string,
  { signal, timeoutMs }: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<HighlightOutcome> {
  const entry = featureById(id);
  if (!entry) return "unknown";
  cancelHighlight();
  clearHighlight();
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const path = routePath(entry.route);
  pending = { controller, path };
  try {
    if (entry.route && navigator && needsNavigation(entry.route, navigator.href()))
      await navigator.navigate(entry.route);
    if (controller.signal.aborted) return "aborted";
    const element = await waitForAnchor(featureAnchorId(entry), {
      signal: controller.signal,
      timeoutMs,
    });
    if (controller.signal.aborted) return "aborted";
    if (!element || !isAnchorVisible(element)) {
      toast("Nicht sichtbar", { description: entry.title });
      return element ? "hidden" : "missing";
    }
    if (!requestSurface({ channel: "spotlight", id, priority: 100, explicit: true }))
      return "aborted";
    element.scrollIntoView?.({ block: "center", inline: "nearest" });
    useHighlightStore.setState({ target: { id, title: entry.title, element, path } });
    return "shown";
  } finally {
    signal?.removeEventListener("abort", abort);
    if (pending?.controller === controller) pending = null;
  }
}

export function useHighlightTarget(): HighlightTarget | null {
  return useHighlightStore((state) => state.target);
}
