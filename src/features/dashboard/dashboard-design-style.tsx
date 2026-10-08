import { useEffect, useRef } from "react";
import { createDashboardStyleController, type DashboardDesign } from "@/lib/dashboard-design";

export function DashboardDesignStyle({
  scopeId,
  design,
  onError,
}: {
  scopeId: string;
  design: DashboardDesign;
  onError: (error: string) => void;
}) {
  const controllerRef = useRef<ReturnType<typeof createDashboardStyleController> | null>(null);
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.dashboardStyle = scopeId;
    document.head.appendChild(style);
    const controller = createDashboardStyleController(
      style,
      `#${CSS.escape(`dashboard-design-${scopeId}`)}`,
      onError,
    );
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [scopeId, onError]);
  useEffect(() => controllerRef.current?.update(design), [design]);
  return null;
}
