import { toPng } from "html-to-image";

const MARK = "data-l8db-redact";
const STYLE_ID = "l8db-redact-style";
const EXCLUDED = new Set(["ai-workspace"]);

const KEEP = "label, th, kbd, [role='columnheader']";
const MEDIA = "input, textarea, select, img, video, canvas, iframe, [contenteditable='true']";

function sensitive(element: Element): boolean {
  if (element.matches(MEDIA)) return true;
  if (element.closest(`${KEEP}, style, script, noscript`)) return false;
  for (const child of element.childNodes)
    if (child.nodeType === Node.TEXT_NODE && child.nodeValue?.trim()) return true;
  return false;
}

export function markSensitive(root: HTMLElement): number {
  const marked = new Set<Element>(root.querySelectorAll(MEDIA));
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || marked.has(parent) || !node.nodeValue?.trim()) continue;
    if (!parent.closest(`${KEEP}, style, script, noscript`)) marked.add(parent);
  }
  for (const element of marked) element.setAttribute(MARK, "");
  if (!root.ownerDocument.getElementById(STYLE_ID)) {
    const style = root.ownerDocument.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `[${MARK}]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;fill:transparent!important;stroke:transparent!important;background-color:#9ca3af!important;border-radius:2px}[${MARK}]::placeholder{color:transparent!important}:is(img,video,canvas,iframe)[${MARK}]{filter:brightness(0)!important}`;
    root.ownerDocument.head.append(style);
  }
  return marked.size;
}

export function unmarkSensitive(root: HTMLElement) {
  for (const element of root.querySelectorAll(`[${MARK}]`)) element.removeAttribute(MARK);
  root.ownerDocument.getElementById(STYLE_ID)?.remove();
}

export async function captureRedactedScreenshot(): Promise<string | null> {
  const root = document.body;
  markSensitive(root);
  try {
    const url = await toPng(root, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      width: window.innerWidth,
      height: window.innerHeight,
      skipFonts: true,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        if (EXCLUDED.has(node.id) || node.getAttribute("aria-label") === "AI-Chat") return false;
        if (!node.hasAttribute(MARK) && sensitive(node)) node.setAttribute(MARK, "");
        const box = node.getBoundingClientRect();
        return box.top < window.innerHeight && box.left < window.innerWidth;
      },
    });
    return url.slice(url.indexOf(",") + 1) || null;
  } finally {
    unmarkSensitive(root);
  }
}
