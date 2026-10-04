import type { JsonKind, JsonPath } from "@/lib/json-editor";

export type JsonCopyFormat = "value" | "key" | "jsonpath" | "js" | "pg" | "pgpath";

export type JsonActions = {
  startEdit: (path: JsonPath, target: "key" | "value") => void;
  copy: (path: JsonPath, format: JsonCopyFormat) => void;
  setKind: (path: JsonPath, kind: JsonKind) => void;
  addChild: (path: JsonPath) => void;
  insertAfter: (path: JsonPath) => void;
  duplicate: (path: JsonPath) => void;
  remove: (path: JsonPath) => void;
  move: (path: JsonPath, delta: number) => void;
  sortKeys: (path: JsonPath) => void;
  unpack: (path: JsonPath) => void;
  pack: (path: JsonPath) => void;
  expandDeep: (path: JsonPath, open: boolean) => void;
  toggleBoolean: (path: JsonPath) => void;
  openUrl: (url: string) => void;
};
