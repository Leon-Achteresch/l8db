import { toast } from "sonner";
import { create } from "zustand";
import { type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { isProduction } from "@/lib/environments";
import { featureById } from "../catalog";
import { releaseSurface, requestSurface } from "../coordinator";
import { cancelHighlight, clearHighlight, isAnchorVisible, waitForAnchor } from "../highlight";
import type { GuideStep } from "../types";

export const GUIDE_ANCHOR_TIMEOUT_MS = 4000;
export const GUIDE_CURSOR_MS = 700;
export const GUIDE_REDUCED_CURSOR_MS = 250;
const NAVIGATION_GRACE_MS = 2500;

export type GuideEndReason = "done" | "stopped" | "escape" | "navigation" | "missing" | "replaced";
export type GuidePhase = "seeking" | "pointing" | "waiting";

export interface GuideView {
  featureId: string;
  title: string;
  steps: readonly GuideStep[];
  index: number;
  element: HTMLElement | null;
  phase: GuidePhase;
  autoClick: boolean;
  manual: boolean;
}

export interface GuideOptions {
  steps?: readonly GuideStep[];
  title?: string;
  advanceOnClick?: boolean;
  allowNavigation?: boolean;
  timeoutMs?: number;
  onEnd?: (reason: GuideEndReason) => void;
}

export interface GuideNavigator {
  navigate: (href: string) => unknown;
  href: () => string;
}

interface Session {
  featureId: string;
  steps: readonly GuideStep[];
  options: GuideOptions;
  controller: AbortController | null;
  timer: ReturnType<typeof setTimeout> | null;
  graceUntil: number;
  path: string | null;
}

export const useGuideStore = create<{ guide: GuideView | null }>()(() => ({ guide: null }));

let session: Session | null = null;
let navigator: GuideNavigator | null = null;

export function setGuideNavigator(next: GuideNavigator | null): () => void {
  navigator = next;
  return () => {
    if (navigator === next) navigator = null;
  };
}

export function isNavigationElement(element: Element): boolean {
  const role = element.getAttribute("role");
  if (role === "tab" || role === "link" || role === "menuitem") return true;
  if (element.tagName === "A" && element.hasAttribute("href")) return true;
  return element.closest('nav, [role="navigation"], [role="tablist"]') !== null;
}

export function canAutoClick(
  step: GuideStep,
  element: Element,
  connection: Pick<SavedConnection, "connectionString" | "kind" | "environment"> | null,
): boolean {
  return step.safeClick === true && !isProduction(connection) && isNavigationElement(element);
}

function activeConnection(): SavedConnection | null {
  const { connections, activeId } = useConnectionsStore.getState();
  return connections.find((connection) => connection.id === activeId) ?? null;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

function pathOf(href: string): string {
  return href.split("?")[0];
}

function currentPath(): string | null {
  return navigator ? pathOf(navigator.href()) : null;
}

function needsNavigation(route: string, href: string): boolean {
  return route.includes("?") ? href !== route : pathOf(href) !== route;
}

function patch(next: Partial<GuideView>): void {
  const { guide } = useGuideStore.getState();
  if (guide) useGuideStore.setState({ guide: { ...guide, ...next } });
}

function clearTimer(current: Session): void {
  if (current.timer) clearTimeout(current.timer);
  current.timer = null;
}

function grace(current: Session): void {
  current.graceUntil = Date.now() + NAVIGATION_GRACE_MS;
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape" || !session) return;
  event.stopPropagation();
  end("escape");
}

function onClick(event: Event): void {
  const current = session;
  const guide = useGuideStore.getState().guide;
  if (!current || !guide?.element) return;
  const target = event.target as Node | null;
  if (!target || !guide.element.contains(target)) return;
  grace(current);
  if (current.options.advanceOnClick !== false) complete(guide.index);
}

function complete(index: number): void {
  const current = session;
  if (!current) return;
  if (index + 1 < current.steps.length) void runStep(index + 1);
  else end("done");
}

async function runStep(index: number): Promise<void> {
  const current = session;
  if (!current) return;
  current.controller?.abort();
  clearTimer(current);
  const controller = new AbortController();
  current.controller = controller;
  const step = current.steps[index];
  patch({ index, element: null, phase: "seeking", autoClick: false });
  if (step.route && navigator && needsNavigation(step.route, navigator.href())) {
    grace(current);
    await navigator.navigate(step.route);
  }
  if (controller.signal.aborted || session !== current) return;
  if (!step.anchor) {
    patch({ phase: "waiting" });
    return;
  }
  const element = await waitForAnchor(step.anchor, {
    signal: controller.signal,
    timeoutMs: current.options.timeoutMs ?? GUIDE_ANCHOR_TIMEOUT_MS,
  });
  if (controller.signal.aborted || session !== current) return;
  if (!element || !isAnchorVisible(element)) {
    end("missing");
    return;
  }
  element.scrollIntoView?.({ block: "center", inline: "nearest" });
  const autoClick = canAutoClick(step, element, activeConnection());
  patch({ element, phase: "pointing", autoClick });
  current.timer = setTimeout(
    () => {
      current.timer = null;
      if (session !== current || controller.signal.aborted) return;
      if (!autoClick || !element.isConnected || !canAutoClick(step, element, activeConnection())) {
        patch({ phase: "waiting", autoClick: false });
        return;
      }
      grace(current);
      element.click();
    },
    prefersReducedMotion() ? GUIDE_REDUCED_CURSOR_MS : GUIDE_CURSOR_MS,
  );
}

const END_TOASTS: Partial<Record<GuideEndReason, string>> = {
  escape: "Anleitung beendet",
  navigation: "Anleitung beendet, Ansicht gewechselt",
  missing: "Anleitung beendet, Schritt nicht gefunden",
};

function end(reason: GuideEndReason): void {
  const current = session;
  if (!current) return;
  const step = current.steps[useGuideStore.getState().guide?.index ?? 0];
  session = null;
  current.controller?.abort();
  current.controller = null;
  clearTimer(current);
  document.removeEventListener("keydown", onKey, true);
  document.removeEventListener("click", onClick, true);
  useGuideStore.setState({ guide: null });
  releaseSurface("spotlight", `guide:${current.featureId}`);
  const message = END_TOASTS[reason];
  if (message) toast(message, reason === "missing" ? { description: step?.title } : undefined);
  try {
    current.options.onEnd?.(reason);
  } catch (error) {
    console.warn("Anleitung konnte nicht sauber beendet werden.", error);
  }
}

export function startGuide(featureId: string, options: GuideOptions = {}): boolean {
  const entry = featureById(featureId);
  const steps = options.steps ?? entry?.steps ?? [];
  if (steps.length === 0) return false;
  end("replaced");
  cancelHighlight();
  clearHighlight();
  requestSurface({ channel: "spotlight", id: `guide:${featureId}`, priority: 100, explicit: true });
  session = {
    featureId,
    steps,
    options,
    controller: null,
    timer: null,
    graceUntil: 0,
    path: currentPath(),
  };
  document.addEventListener("keydown", onKey, true);
  document.addEventListener("click", onClick, true);
  useGuideStore.setState({
    guide: {
      featureId,
      title: options.title ?? entry?.title ?? featureId,
      steps,
      index: 0,
      element: null,
      phase: "seeking",
      autoClick: false,
      manual: options.advanceOnClick === false,
    },
  });
  void runStep(0);
  return true;
}

export function stopGuide(): void {
  end("stopped");
}

export function nextGuideStep(): void {
  const guide = useGuideStore.getState().guide;
  if (guide) complete(guide.index);
}

export function onGuideLocation(pathname: string): void {
  const current = session;
  if (!current || current.path === pathname) return;
  if (current.options.allowNavigation || Date.now() < current.graceUntil || current.path === null) {
    current.path = pathname;
    return;
  }
  end("navigation");
}

export function isGuideRunning(): boolean {
  return session !== null;
}

export function guideHasSteps(featureId: string): boolean {
  return (featureById(featureId)?.steps?.length ?? 0) > 0;
}

export function useGuide(): GuideView | null {
  return useGuideStore((state) => state.guide);
}
