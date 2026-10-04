import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  title: string;
  description?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function FormSection({ title, description, aside, className, children }: Props) {
  return (
    <section className={cn("flex flex-col gap-4", className)}>
      <header className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="text-sm font-semibold tracking-tight text-balance">{title}</h3>
          {description && (
            <p className="max-w-prose text-xs text-pretty text-muted-foreground">{description}</p>
          )}
        </div>
        {aside}
      </header>
      {children}
    </section>
  );
}
