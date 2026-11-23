import { ArrowUp, Plus } from "lucide-react";
import type { ReactNode } from "react";

export function PickerStage({
  index,
  title,
  description,
  above,
  children,
}: {
  index: string;
  title: string;
  description: string;
  above?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title} className="min-w-0 space-y-3">
      <div className="space-y-1">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold">
          <span className="font-mono text-xs font-normal text-muted-foreground">{index}</span>
          {title}
        </h3>
        <p className="max-w-lg text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="relative flex h-[540px] flex-col justify-end overflow-hidden rounded-2xl bg-muted/40 p-4">
        <div className="mx-auto w-full max-w-[460px] space-y-2">
          {above}
          <div className="rounded-2xl border bg-background p-2 shadow-sm">
            <div className="px-2 pt-1 pb-3 text-[13px] text-muted-foreground">
              Frag etwas über deine Datenbank …
            </div>
            <div className="flex items-center gap-1">
              <span className="grid size-8 place-items-center rounded-full text-muted-foreground">
                <Plus className="size-4" />
              </span>
              <div className="flex-1" />
              {children}
              <span className="grid size-8 place-items-center rounded-full bg-foreground text-background">
                <ArrowUp className="size-4" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
