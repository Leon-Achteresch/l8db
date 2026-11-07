import { toCanvas } from "html-to-image";

const MARK = "data-l8db-redact";
const STYLE_ID = "l8db-redact-style";
export const CHAT_SURFACES = "#ai-workspace, #ai-page-surface, [aria-label='AI-Chat']";

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

const STYLE_PROPERTIES = [
  "display",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "box-sizing",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "margin-top",
  "margin-right",
  "margin-bottom",
  "margin-left",
  "padding-top",
  "padding-right",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
  "border-top-style",
  "border-right-style",
  "border-bottom-style",
  "border-left-style",
  "border-top-color",
  "border-right-color",
  "border-bottom-color",
  "border-left-color",
  "border-top-left-radius",
  "border-top-right-radius",
  "border-bottom-left-radius",
  "border-bottom-right-radius",
  "border-collapse",
  "border-spacing",
  "overflow-x",
  "overflow-y",
  "visibility",
  "opacity",
  "flex-grow",
  "flex-shrink",
  "flex-basis",
  "flex-direction",
  "flex-wrap",
  "align-items",
  "align-content",
  "align-self",
  "justify-content",
  "justify-items",
  "justify-self",
  "row-gap",
  "column-gap",
  "order",
  "grid-template-columns",
  "grid-template-rows",
  "grid-column",
  "grid-row",
  "grid-auto-flow",
  "table-layout",
  "vertical-align",
  "color",
  "background-color",
  "background-image",
  "box-shadow",
  "outline",
  "transform",
  "transform-origin",
  "translate",
  "scale",
  "rotate",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "line-height",
  "letter-spacing",
  "text-align",
  "text-overflow",
  "text-transform",
  "white-space",
  "word-break",
  "-webkit-text-fill-color",
  "text-shadow",
  "fill",
  "stroke",
  "filter",
  "cursor",
];

export const CAPTURE_BUDGET_MS = 500;

function shown(node: HTMLElement): boolean {
  if (getComputedStyle(node).display === "contents") return true;
  if (node.checkVisibility && !node.checkVisibility()) return false;
  const box = node.getBoundingClientRect();
  return (
    box.top < window.innerHeight &&
    box.left < window.innerWidth &&
    box.bottom >= 0 &&
    box.right >= 0
  );
}

function crop(source: HTMLCanvasElement, area: DOMRect): string {
  const scale = source.width / window.innerWidth;
  const left = Math.max(0, area.left);
  const top = Math.max(0, area.top);
  const width = Math.round((Math.min(window.innerWidth, area.right) - left) * scale);
  const height = Math.round((Math.min(window.innerHeight, area.bottom) - top) * scale);
  if (width < 1 || height < 1) return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) return "";
  context.drawImage(source, left * scale, top * scale, width, height, 0, 0, width, height);
  return canvas.toDataURL();
}

export async function captureRedactedScreenshot(target?: Element): Promise<string | null> {
  const root = document.body;
  const area = target?.getBoundingClientRect();
  markSensitive(root);
  const deadline = performance.now() + CAPTURE_BUDGET_MS;
  const native = window.getComputedStyle;
  window.getComputedStyle = (element, pseudo) =>
    new Proxy(native.call(window, element, pseudo), {
      get(style, key) {
        if (key === "cssText")
          return STYLE_PROPERTIES.map((name) => `${name}:${style.getPropertyValue(name)}`).join(
            ";",
          );
        const value = Reflect.get(style, key, style);
        return typeof value === "function" ? value.bind(style) : value;
      },
    });
  try {
    const canvas = await toCanvas(root, {
      pixelRatio: Math.min(window.devicePixelRatio || 1, 1.5),
      width: window.innerWidth,
      height: window.innerHeight,
      skipFonts: true,
      filter: (node) => {
        if (!(node instanceof HTMLElement)) return true;
        if (performance.now() > deadline) throw new Error("Screenshot zu aufwendig");
        if (node.matches(CHAT_SURFACES)) return false;
        if (!shown(node)) return false;
        if (!node.hasAttribute(MARK) && sensitive(node)) node.setAttribute(MARK, "");
        return true;
      },
    });
    const url = area ? crop(canvas, area) : canvas.toDataURL();
    return url.slice(url.indexOf(",") + 1) || null;
  } finally {
    window.getComputedStyle = native;
    unmarkSensitive(root);
  }
}
