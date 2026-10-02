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
    isTarget: boolean;
  }[];
};

export type TableNodeType = Node<TableNodeData, "tableNode">;

export type ClusterNodeData = {
  label: string;
  schema: string;
  tableCount: number;
  relationCount: number;
  preview: string[];
  isolated: boolean;
  expanded: boolean;
  loading: boolean;
};

export type ClusterNodeType = Node<ClusterNodeData, "clusterNode">;
export type ErNodeType = TableNodeType | ClusterNodeType;
