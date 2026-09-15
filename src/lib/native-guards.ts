import { IS_MAC } from "@/lib/platform";

const BLOCKED_MOD_KEYS = new Set(["r", "p", "f", "g", "u", "j", "s", "o"]);
const BLOCKED_KEYS = new Set(["F3", "F5", "F7", "BrowserBack", "BrowserForward", "BrowserRefresh"]);

export function isBlockedNativeShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey">,
) {
  if (BLOCKED_KEYS.has(event.key)) return true;
  if (!IS_MAC && event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight"))
    return true;
  const mod = IS_MAC ? event.metaKey : event.ctrlKey;
  return mod && BLOCKED_MOD_KEYS.has(event.key.toLowerCase());
}

export function installNativeGuards() {
  const onContextMenu = (event: MouseEvent) => event.preventDefault();
  const onKeyDown = (event: KeyboardEvent) => {
    if (isBlockedNativeShortcut(event)) event.preventDefault();
  };
  const onMouseUp = (event: MouseEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  const onAuxClick = (event: MouseEvent) => {
    if (event.button === 1) event.preventDefault();
  };
  const onDragStart = (event: DragEvent) => {
    const target = event.target;
    if (
      (target instanceof HTMLImageElement || target instanceof HTMLAnchorElement) &&
      target.getAttribute("draggable") !== "true"
    ) {
      event.preventDefault();
    }
  };
  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) event.preventDefault();
  };

  window.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("mouseup", onMouseUp, true);
  window.addEventListener("auxclick", onAuxClick, true);
  window.addEventListener("dragstart", onDragStart);
  window.addEventListener("wheel", onWheel, { passive: false });

  return () => {
    window.removeEventListener("contextmenu", onContextMenu);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("mouseup", onMouseUp, true);
    window.removeEventListener("auxclick", onAuxClick, true);
    window.removeEventListener("dragstart", onDragStart);
    window.removeEventListener("wheel", onWheel);
  };
}
