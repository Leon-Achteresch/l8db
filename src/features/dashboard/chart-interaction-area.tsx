import type { KeyboardEvent, MouseEvent, ReactNode } from "react";

export function ChartInteractionArea({
  enabled,
  label,
  className,
  onClick,
  onKeyDown,
  children,
}: {
  enabled: boolean;
  label: string;
  className: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}) {
  if (!enabled) return <div className={className}>{children}</div>;
  return (
    <div
      role="application"
      aria-label={label}
      className={`${className} [&_[data-active-dim]]:cursor-pointer [&_[data-dim]]:cursor-pointer`}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
