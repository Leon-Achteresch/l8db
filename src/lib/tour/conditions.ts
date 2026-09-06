import { useConnectionsStore } from "@/lib/connections";
import type { TourSkipIf, TourWait } from "@/lib/tour/types";

export function selectorExists(selector: string) {
  return Boolean(document.querySelector(selector));
}

export function firstTableTarget() {
  return document.querySelector<HTMLElement>("[data-tour='sidebar-table']");
}

export function shouldSkipStep(skipIf: TourSkipIf | undefined) {
  if (!skipIf) return false;
  const connections = useConnectionsStore.getState().connections.length;
  const active = Boolean(useConnectionsStore.getState().activeId);
  if (skipIf === "has-connection") return connections > 0;
  if (skipIf === "no-connection") return connections === 0 || !active;
  if (skipIf === "no-tables") return !firstTableTarget();
  if (skipIf === "editor-open") return selectorExists("[data-tour='connection-editor']");
  return false;
}

export function isWaitMet(wait: TourWait, baseline: number, clicked: boolean, pathname: string) {
  if (wait.type === "connection-added") {
    return useConnectionsStore.getState().connections.length > baseline;
  }
  if (wait.type === "active-connection") {
    return Boolean(useConnectionsStore.getState().activeId);
  }
  if (wait.type === "click") return clicked;
  if (wait.type === "route") return pathname.includes(wait.includes);
  return selectorExists(wait.selector);
}

export function clickSelector(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return false;
  el.click();
  return true;
}

export function waitForSelector(selector: string, timeoutMs = 4000) {
  return new Promise<boolean>((resolve) => {
    if (document.querySelector(selector)) {
      resolve(true);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (document.querySelector(selector)) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 80);
  });
}
