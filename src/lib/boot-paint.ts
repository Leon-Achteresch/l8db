export const BOOT_PAINT_KEY = "l8db.boot";

const SOURCES = {
  bg: "--background",
  fg: "--foreground",
  card: "--card",
  line: "--border",
  accent: "--primary",
};

type BootWindow = Window & typeof globalThis;

export function rememberBootPaint(target: BootWindow = window) {
  const root = target.document.documentElement;
  const style = target.getComputedStyle(root);
  const vars = Object.fromEntries(
    Object.entries(SOURCES).map(([name, source]) => [name, style.getPropertyValue(source).trim()]),
  );
  if (!vars.bg) return;
  const next = JSON.stringify({
    theme: target.localStorage.getItem("theme") ?? "system",
    mode: root.classList.contains("dark") ? "dark" : "light",
    vars,
  });
  try {
    if (target.localStorage.getItem(BOOT_PAINT_KEY) !== next)
      target.localStorage.setItem(BOOT_PAINT_KEY, next);
  } catch {}
}

export function initBootPaint(target: BootWindow = window, delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    timer ??= setTimeout(() => {
      timer = undefined;
      rememberBootPaint(target);
    }, delayMs);
  };
  const observer = new target.MutationObserver(schedule);
  observer.observe(target.document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  schedule();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
  };
}
