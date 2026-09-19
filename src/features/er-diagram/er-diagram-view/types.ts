import type { Node } from "@xyflow/react";

export type TableNodeData = {
  label: string;
  schema: string;
  columns: {
    name: string;
    dataType: string;
    isPrimaryKey: boolean;
    isNullable: boolean;
    isForeignKey: boolean;
  }[];
};

export type TableNodeType = Node<TableNodeData, "tableNode">;
