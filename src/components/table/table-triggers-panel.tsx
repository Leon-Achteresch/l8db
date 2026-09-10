import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { ChevronDownIcon, ZapIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { useTriggersQuery } from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

interface TableTriggersPanelProps {
  schema: string;
  table: string;
}

export function TableTriggersPanel({ schema, table }: TableTriggersPanelProps) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className="flex shrink-0 flex-col border-b bg-muted/30">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium text-foreground"
        >
          <ZapIcon className="size-4 text-orange-500" />
          Trigger
          {count > 0 && (
            <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
              {count}
            </Badge>
          )}
          <motion.span
            animate={{ rotate: open ? 180 : 0 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="inline-flex"
          >
            <ChevronDownIcon className="size-4 text-muted-foreground" />
          </motion.span>
        </button>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="triggers-body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{
              height: { duration: 0.26, ease: [0.32, 0.72, 0, 1] },
              opacity: { duration: 0.18 },
            }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3">
              {isLoading ? (
                <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                  <Spinner />
                  Lade Trigger…
                </div>
              ) : count === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">
                  Keine Trigger vorhanden.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {triggers!.map((trigger) => (
                    <button
                      key={trigger.trigger_name}
                      type="button"
                      onClick={() => handleNavigate(trigger.trigger_name)}
                      className={cn(
                        "flex items-center gap-3 rounded-md px-3 py-2 text-left transition-colors",
                        "hover:bg-accent/60",
                      )}
                    >
                      <ZapIcon className="size-3.5 shrink-0 text-orange-500" />
                      <span className="flex-1 truncate text-sm font-medium text-foreground">
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
                    </button>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
