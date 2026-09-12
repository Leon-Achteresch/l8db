import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Step({
  n,
  title,
  hint,
  done,
  active,
  optional,
  children,
}: {
  n: number;
  title: string;
  hint: string;
  done: boolean;
  active: boolean;
  optional?: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <section className="rounded-xl border bg-card/60 p-5">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={cn(
            "grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold",
            done ? "bg-lime-400 text-lime-950" : "bg-muted text-muted-foreground",
          )}
        >
          {done ? <CheckIcon className="size-3" /> : n}
        </span>
        <h3 className="text-xs font-semibold">{title}</h3>
        {optional && <span className="text-[10px] text-muted-foreground">optional</span>}
      </div>
      <p className="mb-2.5 pl-7 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
      <div className="space-y-2 pl-7">{children}</div>
    </section>
  );
}
