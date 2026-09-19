export type BindParamType = "text" | "int" | "numeric" | "bool" | "timestamp" | "null";

export const BIND_PARAM_TYPES: BindParamType[] = [
  "text",
  "int",
  "numeric",
  "bool",
  "timestamp",
  "null",
];

export const BIND_PARAM_TYPE_LABELS: Record<BindParamType, string> = {
  text: "Text",
  int: "Ganzzahl",
  numeric: "Dezimalzahl",
  bool: "Boolean",
  timestamp: "Zeitstempel",
  null: "NULL",
};

export interface BindParamRef {
  name: string;
  named: boolean;
  label: string;
}

export interface BindParamOccurrence {
  start: number;
  end: number;
  name: string;
  named: boolean;
}

export interface BindParamValue {
  type: BindParamType;
  value: string;
}

export interface ParameterizedQuery {
  sql: string;
  values: (string | null)[];
}
