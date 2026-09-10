import {
  SIDEBAR_PANEL_MAX_WIDTH,
  SIDEBAR_PANEL_MIN_WIDTH,
  selectSidebarPanelWidth,
  useSidebarPanel,
} from "@/lib/sidebar-panel";

export function AppSidebarResizeHandle() {
  const panelWidth = useSidebarPanel(selectSidebarPanelWidth);
  const setWidth = useSidebarPanel((state) => state.setWidth);
  const setDragWidth = useSidebarPanel((state) => state.setDragWidth);
  const setIsResizing = useSidebarPanel((state) => state.setIsResizing);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = useSidebarPanel.getState().width;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      setDragWidth(startWidth + (moveEvent.clientX - startX));
    };

    const handlePointerUp = () => {
      const { dragWidth } = useSidebarPanel.getState();
      if (dragWidth !== null) {
        setWidth(dragWidth);
      } else {
        setDragWidth(null);
      }
      setIsResizing(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };

    setIsResizing(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={panelWidth}
      aria-valuemin={SIDEBAR_PANEL_MIN_WIDTH}
      aria-valuemax={SIDEBAR_PANEL_MAX_WIDTH}
      onPointerDown={handlePointerDown}
      className="absolute inset-y-0 right-0 z-50 w-3 shrink-0 cursor-col-resize touch-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-sidebar-border after:opacity-0 after:transition-opacity hover:after:opacity-100"
    />
  );
}
