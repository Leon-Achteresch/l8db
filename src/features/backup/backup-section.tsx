import type { ReactNode } from "react";

interface BackupSectionProps {
  title: string;
  children: ReactNode;
}

export function BackupSection({ title, children }: BackupSectionProps) {
  return (
    <section className="grid gap-2.5 border-b py-5 last:border-b-0">
      <h3 className="ml-[calc(9rem+1rem)] text-xs font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}
