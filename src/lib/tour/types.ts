export type TourSide = "top" | "right" | "bottom" | "left" | "over";

export type TourWait =
  | { type: "connection-added" }
  | { type: "active-connection" }
  | { type: "click"; selector: string }
  | { type: "route"; includes: string }
  | { type: "element"; selector: string };

export type TourSkipIf = "has-connection" | "no-connection" | "no-tables" | "editor-open";

export type TourStep = {
  id: string;
  title: string;
  body: string;
  target?: string;
  route?: string;
  tableRoute?: boolean;
  autoClick?: string;
  wait?: TourWait;
  waitHint?: string;
  skipIf?: TourSkipIf;
  side?: TourSide;
  openTx?: boolean;
};

export type TourChapter = {
  id: string;
  title: string;
  summary: string;
  steps: TourStep[];
};
