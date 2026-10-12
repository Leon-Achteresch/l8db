const eventTypes = [
  "pointerdown",
  "pointerup",
  "pointercancel",
  "pointermove",
  "pointerover",
  "pointerout",
  "mousedown",
  "mouseup",
  "mousemove",
  "mouseover",
  "mouseout",
  "mouseenter",
  "mouseleave",
  "click",
  "dblclick",
  "auxclick",
  "contextmenu",
  "wheel",
  "touchstart",
  "touchmove",
  "touchend",
  "touchcancel",
  "dragstart",
  "dragenter",
  "dragover",
  "dragleave",
  "dragend",
  "drop",
] as const;

type Scope = {
  container: HTMLElement;
  dismiss: () => void;
  pointerDown: boolean;
  contextMenuPending: boolean;
  frame: number | null;
};

const documents = new WeakMap<Document, { scopes: Scope[]; listener: (event: Event) => void }>();

export function acquireHistoryModalBoundary(container: HTMLElement, dismiss: () => void) {
  const document = container.ownerDocument;
  let entry = documents.get(document);
  if (!entry) {
    const scopes: Scope[] = [];
    const listener = (event: Event) => {
      const scope = scopes.at(-1);
      if (!scope) return;
      const pointerReleased = event.type === "pointerup" || event.type === "pointercancel";
      if (pointerReleased) scope.pointerDown = false;
      if (
        !scope.contextMenuPending &&
        event.target instanceof Node &&
        scope.container.contains(event.target)
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.type === "pointerdown") scope.pointerDown = true;
      if (pointerReleased) {
        if (scope.contextMenuPending && scope.frame === null) {
          const window = document.defaultView;
          if (!window) return scope.dismiss();
          scope.frame = window.requestAnimationFrame(() => {
            scope.frame = null;
            if (scopes.includes(scope)) scope.dismiss();
          });
        }
      }
      if (event.type === "contextmenu") {
        if (scope.pointerDown) scope.contextMenuPending = true;
        else scope.dismiss();
      }
      if (event.type === "click" && !scope.contextMenuPending) scope.dismiss();
    };
    entry = { scopes, listener };
    documents.set(document, entry);
    for (const type of eventTypes)
      document.addEventListener(type, listener, { capture: true, passive: false });
  }
  const scope: Scope = {
    container,
    dismiss,
    pointerDown: false,
    contextMenuPending: false,
    frame: null,
  };
  entry.scopes.push(scope);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (scope.frame !== null) document.defaultView?.cancelAnimationFrame(scope.frame);
    const currentDocument = documents.get(document);
    if (!currentDocument) return;
    const index = currentDocument.scopes.indexOf(scope);
    if (index >= 0) currentDocument.scopes.splice(index, 1);
    if (currentDocument.scopes.length === 0) {
      for (const type of eventTypes)
        document.removeEventListener(type, currentDocument.listener, true);
      documents.delete(document);
    }
  };
}
