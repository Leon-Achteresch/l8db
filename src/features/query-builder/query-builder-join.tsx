import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { QueryBuilderSection } from "@/features/query-builder/query-builder-section";
import type { ForeignKeyInfo } from "@/lib/db";
import {
  BASE_ALIAS,
  type BuilderJoin,
  JOIN_ALIAS,
  type JoinType,
  joinKey,
  joinLabel,
} from "@/lib/query-builder";

const NO_JOIN = "__none__";

interface QueryBuilderJoinProps {
  relations: ForeignKeyInfo[];
  selectedKey: string | null;
  join: BuilderJoin | null;
  joinType: JoinType;
  loading?: boolean;
  onSelect: (key: string | null) => void;
  onJoinTypeChange: (type: JoinType) => void;
}

export function relationKey(relation: ForeignKeyInfo): string {
  return joinKey({
    constraintName: relation.constraint_name,
    schema: relation.to_schema,
    table: relation.to_table,
    fromColumn: relation.from_column,
    toColumn: relation.to_column,
  });
}

export function relationLabel(relation: ForeignKeyInfo): string {
  return joinLabel({
    constraintName: relation.constraint_name,
    schema: relation.to_schema,
    table: relation.to_table,
    fromColumn: relation.from_column,
    toColumn: relation.to_column,
  });
}

export function QueryBuilderJoin({
  relations,
  selectedKey,
  join,
  joinType,
  loading,
  onSelect,
  onJoinTypeChange,
}: QueryBuilderJoinProps) {
  return (
    <QueryBuilderSection title="Joins" count={join ? 1 : 0}>
      {loading ? (
        <p className="text-xs text-muted-foreground">Lädt…</p>
      ) : relations.length === 0 ? (
        <p className="text-xs text-muted-foreground">Keine ausgehenden Fremdschlüssel</p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Select value={joinType} onValueChange={(value) => onJoinTypeChange(value as JoinType)}>
              <SelectTrigger
                size="sm"
                className="h-7 w-20 shrink-0 font-mono text-xs"
                aria-label="Join-Typ"
                disabled={selectedKey === null}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INNER">inner</SelectItem>
                <SelectItem value="LEFT">left</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={selectedKey ?? NO_JOIN}
              onValueChange={(value) => onSelect(value === NO_JOIN ? null : value)}
            >
              <SelectTrigger
                size="sm"
                className="h-7 min-w-0 flex-1 font-mono text-xs"
                aria-label="Beziehung"
              >
                <SelectValue placeholder="Beziehung" />
              </SelectTrigger>
              <SelectContent searchable>
                <SelectItem value={NO_JOIN}>Kein Join</SelectItem>
                {relations.map((relation) => (
                  <SelectItem key={relationKey(relation)} value={relationKey(relation)}>
                    {relationLabel(relation)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {join && (
            <p className="truncate pl-1 font-mono text-xs text-muted-foreground">
              <span className="text-primary">on</span> {JOIN_ALIAS}.{join.toColumn} = {BASE_ALIAS}.
              {join.fromColumn}
            </p>
          )}
        </div>
      )}
    </QueryBuilderSection>
  );
}
