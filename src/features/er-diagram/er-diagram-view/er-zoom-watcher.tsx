import { type ReactFlowState, useStore } from "@xyflow/react";
import { useEffect } from "react";
import { COMPACT_ZOOM } from "@/features/er-diagram/er-diagram-view/constants";

const zoomedOut = (state: ReactFlowState) => state.transform[2] < COMPACT_ZOOM;

export function ErZoomWatcher({ onChange }: { onChange: (compact: boolean) => void }) {
  const compact = useStore(zoomedOut);
  useEffect(() => onChange(compact), [compact, onChange]);
  return null;
}
