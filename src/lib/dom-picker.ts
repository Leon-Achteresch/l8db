import { CHAT_SURFACES } from "@/lib/issue-screenshot";

const BLOCKED = [
  "pointerdown",
  "pointerup",
  "mousedown",
  "mouseup",
  "dblclick",
  "auxclick",
  "contextmenu",
] as const;

export function pickElement(signal?: AbortSignal): Promise<Element | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.dataset.domPicker = "";
    box.style.cssText =
      "position:fixed;z-index:2147483647;display:none;pointer-events:none;box-sizing:border-box;border:2px solid rgb(59 130 246);border-radius:3px;background:rgb(59 130 246 / 0.14)";
    const label = document.createElement("div");
    label.style.cssText =
      "position:absolute;left:-2px;padding:1px 6px;border-radius:4px;background:rgb(29 78 216);color:#fff;font:500 11px/18px ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap";
    box.append(label);
    const cursor = document.createElement("style");
    cursor.textContent = "*{cursor:crosshair!important}";
    document.head.append(cursor);
    document.body.append(box);
    let current: Element | null = null;
    let hovered: Element | null = null;
    const children: Element[] = [];
    const show = (element: Element | null) => {
      current = element;
      if (!element) {
        box.style.display = "none";
        return;
      }
      const rect = element.getBoundingClientRect();
      box.style.display = "block";
      box.style.left = `${rect.left}px`;
      box.style.top = `${rect.top}px`;
      box.style.width = `${rect.width}px`;
      box.style.height = `${rect.height}px`;
      label.style.top = rect.top < 22 ? "0" : "-22px";
      label.textContent = `${element.tagName.toLowerCase()}  ${Math.round(rect.width)} × ${Math.round(rect.height)}`;
    };
    const hit = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y);
      return element?.closest(CHAT_SURFACES) ? null : element;
    };
    const block = (event: Event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const move = (event: PointerEvent) => {
      const target = hit(event.clientX, event.clientY);
      if (target === hovered) return;
      hovered = target;
      children.length = 0;
      show(target);
    };
    const click = (event: MouseEvent) => {
      block(event);
      const target = hit(event.clientX, event.clientY);
      finish(target && (current ?? target));
    };
    const key = (event: KeyboardEvent) => {
      block(event);
      if (event.key === "Escape") finish(null);
      else if (event.key === "Enter") finish(current);
      else if (event.key === "ArrowUp" && current?.parentElement) {
        children.push(current);
        show(current.parentElement);
      } else if (event.key === "ArrowDown" && children.length) show(children.pop() ?? null);
    };
    const follow = () => show(current);
    const finish = (element: Element | null) => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("click", click, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", follow, true);
      for (const type of BLOCKED) window.removeEventListener(type, block, true);
      signal?.removeEventListener("abort", cancel);
      box.remove();
      cursor.remove();
      resolve(element);
    };
    const cancel = () => finish(null);
    if (signal?.aborted) return cancel();
    signal?.addEventListener("abort", cancel);
    window.addEventListener("pointermove", move, true);
    window.addEventListener("click", click, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", follow, { capture: true, passive: true });
    for (const type of BLOCKED) window.addEventListener(type, block, true);
  });
}
