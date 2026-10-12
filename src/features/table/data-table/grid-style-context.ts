import { createContext } from "react";
import type { ColumnProfile } from "@/lib/column-profile";
import type { GridColumnKind } from "@/lib/grid-cell-format";
import type { TableStyle } from "@/lib/table-style";

export type GridColumnStyle = {
  kind: GridColumnKind;
  numeric: boolean;
  primaryKey: boolean;
  categorical: boolean;
  profile: ColumnProfile | null;
};

export type GridStyle = {
  style: TableStyle;
  columns: ReadonlyMap<string, GridColumnStyle>;
  now: Date;
};

export const GridStyleContext = createContext<GridStyle>({
  style: "classic",
  columns: new Map(),
  now: new Date(),
});
