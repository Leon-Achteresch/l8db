import { TriangleAlertIcon } from "lucide-react";
import {
  ACTION_TYPES,
  STEP_CATALOG,
  STEP_GROUP_TONE,
  STEP_GROUPS,
} from "@/lib/automation/step-catalog";
import type { ActionType } from "@/lib/db/automation";
import { cn } from "@/lib/utils";

interface Props {
  onPick: (type: ActionType) => void;
}

export function StepCatalogGrid({ onPick }: Props) {
  return (
    <div className="@container/catalog mx-auto flex max-w-4xl flex-col gap-7 px-5 pt-6 pb-16">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold tracking-tight">Womit soll der Task beginnen?</h3>
        <p className="max-w-prose text-xs text-pretty text-muted-foreground">
          Jeder Schritt erledigt eine Sache. Danach kannst du weitere anhängen, Schleifen bauen und
          festlegen, was bei einem Fehler passiert.
        </p>
      </div>
      {STEP_GROUPS.map((group) => (
        <section key={group} className="flex flex-col gap-2">
          <h4 className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {group}
          </h4>
          <div className="grid grid-cols-1 gap-1.5 @md/catalog:grid-cols-2 @3xl/catalog:grid-cols-3">
            {ACTION_TYPES.filter((type) => STEP_CATALOG[type].group === group).map((type) => {
              const entry = STEP_CATALOG[type];
              const Icon = entry.icon;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => onPick(type)}
                  className="group/card flex items-start gap-2.5 rounded-xl border border-transparent bg-muted/40 p-2.5 text-left transition-[background-color,border-color,transform] duration-150 outline-none hover:border-border hover:bg-card focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.985]"
                >
                  <span
                    className={cn(
                      "grid size-8 shrink-0 place-items-center rounded-lg",
                      STEP_GROUP_TONE[group],
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 text-[13px] font-medium">
                      {entry.label}
                      {entry.risky && (
                        <TriangleAlertIcon
                          className="size-3 text-amber-600 dark:text-amber-400"
                          aria-label="Verändert Daten oder Dateien"
                        />
                      )}
                    </span>
                    <span className="line-clamp-2 text-xs text-pretty text-muted-foreground">
                      {entry.description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
