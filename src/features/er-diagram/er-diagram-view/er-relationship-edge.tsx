import { BaseEdge, type Edge, type EdgeProps } from "@xyflow/react";
import {
  type ErPoint,
  relationshipPath,
} from "@/features/er-diagram/er-diagram-view/route-relationship";

export function ErRelationshipEdge({
  id,
  data,
  markerEnd,
  style,
}: EdgeProps<Edge<{ points: ErPoint[]; label: string }>>) {
  if (!data?.points.length) return null;
  return (
    <g>
      <title>{data.label}</title>
      <BaseEdge id={id} path={relationshipPath(data.points)} markerEnd={markerEnd} style={style} />
    </g>
  );
}
