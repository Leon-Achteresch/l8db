import type { ReactNode } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ForeignKeyInfo } from "@/lib/db";
import { type JoinType, joinKey, joinLabel } from "@/lib/query-builder";

const NO_JOIN = "__none__";

interface QueryBuilderJoinProps {
  relations: ForeignKeyInfo[];
  selectedKey: string | null;
  joinType: JoinType;
  loading?: boolean;
  onSelect: (key: string | null) => void;
  onJoinTypeChange: (type: JoinType) => void;
  children?: ReactNode;
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
  joinType,
  loading,
  onSelect,
  onJoinTypeChange,
  children,
}: QueryBuilderJoinProps) {
  return (
    <div className="rounded-md border">
      <div className="border-b px-3 py-2 text-sm font-medium">Fremdschlüssel-Join</div>
      <div className="space-y-3 p-3">
        {loading ? (
          <p className="text-sm text-muted-foreground">Beziehungen werden geladen…</p>
        ) : relations.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Für diese Tabelle sind keine ausgehenden Fremdschlüssel vorhanden.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={selectedKey ?? NO_JOIN}
              onValueChange={(value) => onSelect(value === NO_JOIN ? null : value)}
            >
              <SelectTrigger className="w-[26rem]">
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
            <Select value={joinType} onValueChange={(value) => onJoinTypeChange(value as JoinType)}>
              <SelectTrigger className="w-40" disabled={selectedKey === null}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="INNER">INNER JOIN</SelectItem>
                <SelectItem value="LEFT">LEFT JOIN</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
