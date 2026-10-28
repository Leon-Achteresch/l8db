import type { ReactNode } from "react";

export function ResultCompareNotice({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="flex h-full flex-col items-center justify-center gap-3 bg-card/30 p-6 text-center"
    >
      <span className="flex size-10 items-center justify-center rounded-xl border bg-card text-muted-foreground shadow-xs [&_svg]:size-4.5">
        {icon}
      </span>
      <div className="max-w-md space-y-1.5">
        <p className="text-[13px] font-semibold tracking-[-0.005em]">{title}</p>
        <div className="text-xs leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}
