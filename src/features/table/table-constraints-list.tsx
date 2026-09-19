import { motion } from "motion/react";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useConstraintsQuery } from "@/lib/queries";
import {
  ConstraintTypeIcon,
  constraintTypeColor,
} from "./table-constraints-list/constraint-type-icon";

interface TableConstraintsListProps {
  schema: string;
  table: string;
}

export function TableConstraintsList({ schema, table }: TableConstraintsListProps) {
  const { data: constraints, isLoading } = useConstraintsQuery(schema, table);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Constraints…
      </div>
    );
  }

  if (!constraints || constraints.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Constraints gefunden.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-4 py-2">
        <span className="text-xs font-medium text-muted-foreground">Constraints</span>
        <span className="ml-auto text-xs text-muted-foreground">{constraints.length}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto divide-y">
        {constraints.map((con) => (
          <motion.div
            key={con.name}
            layout
            transition={{ layout: SPRING_LAYOUT }}
            className="px-4 py-3 hover:bg-muted/30 transition-colors"
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <ConstraintTypeIcon type={con.constraint_type} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <span className="text-sm font-medium font-mono text-foreground">{con.name}</span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] px-1.5 py-0 font-medium ${constraintTypeColor(con.constraint_type)} border-current/20 bg-current/5`}
                  >
                    {con.constraint_type}
                  </Badge>
                </div>
                {con.columns.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-1">
                    {con.columns.map((col) => (
                      <span
                        key={col}
                        className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                      >
                        {col}
                      </span>
                    ))}
                  </div>
                )}
                <p className="font-mono text-[11px] text-muted-foreground/70 break-all">
                  {con.definition}
                </p>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
