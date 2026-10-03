import { type ReactFlowState, useStore } from "@xyflow/react";
import { useEffect } from "react";
import { visibleClusterIds } from "@/features/er-diagram/er-diagram-view/cluster-visibility";

const selectVisibility = (state: ReactFlowState) =>
  JSON.stringify(
    visibleClusterIds(
      state.nodes.flatMap((node) =>
        node.type === "clusterNode"
          ? [
              {
                id: node.id,
                position: node.position,
                width: node.width ?? 0,
                height: node.height ?? 0,
              },
            ]
          : [],
      ),
      { x: state.transform[0], y: state.transform[1], zoom: state.transform[2] },
      state.width,
      state.height,
    ),
  );

export function ErViewportWatcher({ onChange }: { onChange: (ids: string[]) => void }) {
  const visibility = useStore(selectVisibility);
  useEffect(() => {
    onChange(JSON.parse(visibility) as string[]);
  }, [visibility, onChange]);
  return null;
}
