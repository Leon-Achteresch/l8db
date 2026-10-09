import { FocusScope } from "@radix-ui/react-focus-scope";
import { hideOthers } from "aria-hidden";
import { XIcon } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Sheet, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { QueryHistoryPanel } from "@/features/query/query-history-panel";
import { acquireHistoryModalBoundary } from "@/lib/history-modal-boundary";
import { PortalContainerContext, registerPortalContainer } from "@/lib/portal-container";

const suspendedToasters = new WeakMap<
  HTMLElement,
  { owners: number; visibility: string; priority: string }
>();

function suspendOutsideToasters(dialog: HTMLElement) {
  const targets = new Set<HTMLElement>();
  const toasters = [
    ...dialog.ownerDocument.querySelectorAll<HTMLElement>(
      'section[data-react-aria-top-layer][aria-live="polite"][aria-relevant="additions text"]',
    ),
  ].filter((toaster) => !dialog.contains(toaster));
  const suspend = (toaster: HTMLElement) => {
    if (targets.has(toaster)) return;
    targets.add(toaster);
    const current = suspendedToasters.get(toaster);
    if (current) current.owners++;
    else {
      suspendedToasters.set(toaster, {
        owners: 1,
        visibility: toaster.style.getPropertyValue("visibility"),
        priority: toaster.style.getPropertyPriority("visibility"),
      });
      toaster.style.setProperty("visibility", "hidden");
    }
  };
  const restore = (toaster: HTMLElement) => {
    if (!targets.delete(toaster)) return;
    const current = suspendedToasters.get(toaster);
    if (!current || --current.owners > 0) return;
    if (current.visibility)
      toaster.style.setProperty("visibility", current.visibility, current.priority);
    else toaster.style.removeProperty("visibility");
    suspendedToasters.delete(toaster);
  };
  const parents = new Set<HTMLElement>();
  for (const toaster of toasters) {
    suspend(toaster);
    const parent = toaster.parentElement?.parentElement;
    if (parent) parents.add(parent);
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.removedNodes)
        if (node instanceof HTMLElement && node.matches("[data-toast-drop]")) restore(node);
      for (const node of record.addedNodes)
        if (node instanceof HTMLElement && node.matches("[data-toast-drop]")) suspend(node);
    }
  });
  for (const parent of parents) {
    for (const child of parent.children)
      if (child instanceof HTMLElement && child.matches("[data-toast-drop]")) suspend(child);
    observer.observe(parent, { childList: true });
  }
  return () => {
    observer.disconnect();
    for (const target of targets) restore(target);
  };
}

interface QueryHistorySheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  connectionId: string | null;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
}

export function QueryHistorySheet({
  open,
  onOpenChange,
  connectionId,
  onLoad,
}: QueryHistorySheetProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const returnFocus = useRef<HTMLElement | null>(null);
  const focusOnClose = useRef(true);
  const latest = useRef({ open, onOpenChange });
  latest.current = { open, onOpenChange };
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [content, setContent] = useState<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const host = document.createElement("div");
    host.dataset.slot = "query-history-host";
    host.style.position = "fixed";
    host.style.inset = "0";
    host.style.contain = "layout style";
    host.style.pointerEvents = "none";
    host.style.zIndex = "50";
    document.body.appendChild(host);
    setHost(host);
    return () => {
      host.remove();
    };
  }, []);

  useLayoutEffect(() => {
    if (!open || !content) return;
    const releaseBoundary = acquireHistoryModalBoundary(content, () =>
      latest.current.onOpenChange(false),
    );
    const restoreHidden = hideOthers(content);
    const releasePortal = registerPortalContainer(content);
    const restoreToasters = suspendOutsideToasters(content);
    return () => {
      releaseBoundary();
      restoreHidden();
      releasePortal();
      restoreToasters();
    };
  }, [open, content]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      {host &&
        open &&
        createPortal(
          <>
            <div
              aria-hidden="true"
              data-slot="query-history-overlay"
              className="pointer-events-auto fixed inset-0 z-50 bg-black/10"
              style={{ animation: "none" }}
            />
            <FocusScope
              asChild
              loop
              trapped
              onMountAutoFocus={(event) => {
                event.preventDefault();
                const active = document.activeElement;
                returnFocus.current =
                  active instanceof HTMLElement && active !== document.body ? active : null;
                focusOnClose.current = true;
                searchRef.current?.focus({ preventScroll: true });
              }}
              onUnmountAutoFocus={(event) => {
                event.preventDefault();
                if (latest.current.open || !focusOnClose.current) return;
                const target = returnFocus.current?.isConnected
                  ? returnFocus.current
                  : document.querySelector<HTMLElement>('[aria-label="Weitere Werkzeuge"]');
                target?.focus({ preventScroll: true });
                returnFocus.current = null;
              }}
            >
              <div
                ref={setContent}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                aria-describedby={descriptionId}
                tabIndex={-1}
                data-slot="query-history-dialog"
                data-state="open"
                className="pointer-events-auto fixed inset-y-0 right-0 z-50 flex h-full w-[min(100vw-1rem,480px)] flex-col gap-0 rounded-l-xl border-l bg-popover p-0 text-sm text-popover-foreground shadow-lg outline-none"
                onKeyDown={(event) => {
                  if (event.key !== "Escape" || event.defaultPrevented) return;
                  if (content?.querySelector('[aria-label="Command palette"]')) return;
                  event.preventDefault();
                  onOpenChange(false);
                }}
              >
                <PortalContainerContext value={content ?? undefined}>
                  <SheetHeader className="border-b p-4 pr-12">
                    <SheetTitle className="text-sm" id={titleId}>
                      Verlauf & Gespeichertes
                    </SheetTitle>
                    <SheetDescription className="text-xs" id={descriptionId}>
                      Zuletzt ausgeführte Queries und dauerhaft gespeicherte Abfragen.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="flex min-h-0 flex-1 flex-col">
                    <QueryHistoryPanel
                      searchRef={searchRef}
                      connectionId={connectionId}
                      onLoad={(sql, mode) => {
                        focusOnClose.current = false;
                        onLoad(sql, mode);
                        onOpenChange(false);
                      }}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    className="absolute top-4 right-4"
                    size="icon-sm"
                    aria-label="Verlauf schließen"
                    onClick={() => onOpenChange(false)}
                  >
                    <XIcon />
                  </Button>
                  <Toaster />
                </PortalContainerContext>
              </div>
            </FocusScope>
          </>,
          host,
        )}
    </Sheet>
  );
}
