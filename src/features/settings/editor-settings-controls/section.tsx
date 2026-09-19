import type { SectionProps } from "./types";

export function Section({ title, description, children }: SectionProps) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="space-y-2">{children}</div>
    </section>
  );
}
