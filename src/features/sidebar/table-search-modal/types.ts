export interface Condition {
  id: string;
  column: string;
  operator: string;
  value: string;
}

export type Combinator = "AND" | "OR";
export type FilterMode = "simple" | "sql";
export type SearchMode = "objects" | "content";

export interface MatchedEntity {
  schema: string;
  name: string;
  type: "table" | "view";
  matchingColumns: string[];
}
