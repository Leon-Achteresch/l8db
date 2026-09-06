import { useNavigate } from "@tanstack/react-router";
import { ZapIcon } from "lucide-react";
import { motion } from "motion/react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useTriggersQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface TableTriggersListProps {
  schema: string;
  table: string;
}

export function TableTriggersList({ schema, table }: TableTriggersListProps) {
  const { data: triggers, isLoading } = useTriggersQuery(schema, table);
  const navigate = useNavigate();
  const openTriggerTab = useTableTabs((state) => state.openTriggerTab);

  const count = triggers?.length ?? 0;

  const handleNavigate = (triggerName: string) => {
    openTriggerTab({ schema, table, trigger: triggerName });
    void navigate({
      to: "/triggers/$schema/$table/$trigger",
      params: { schema, table, trigger: triggerName },
    });
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
        <Spinner />
        Lade Trigger…
      </div>
    );
  }

  if (count === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-muted-foreground">Keine Trigger vorhanden.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-2 border-b bg-muted/30 px-4 py-2.5">
        <ZapIcon className="size-4 text-orange-500" />
        <span className="text-sm font-medium text-foreground">{count} Trigger</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="flex flex-col gap-0.5">
          {triggers!.map((trigger) => (
            <motion.button
              key={trigger.trigger_name}
              type="button"
              layout
              transition={{ layout: SPRING_LAYOUT }}
              onClick={() => handleNavigate(trigger.trigger_name)}
              className={cn(
                "flex items-center gap-3 rounded-md px-3 py-2.5 text-left transition-colors",
                "hover:bg-accent/60",
              )}
            >
              <ZapIcon className="size-4 shrink-0 text-orange-500" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                {trigger.trigger_name}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                {trigger.timing} {trigger.event}
              </span>
              <Badge
                variant={trigger.enabled === "DISABLED" ? "destructive" : "outline"}
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {trigger.orientation}
              </Badge>
              <Badge
                variant={trigger.enabled === "DISABLED" ? "destructive" : "secondary"}
                className="shrink-0 text-[10px] px-1.5 py-0"
              >
                {trigger.enabled}
              </Badge>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
