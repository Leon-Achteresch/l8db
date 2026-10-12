import type { ReactNode } from "react";

export function CategoryRow({
  interactive,
  dim,
  className,
  title,
  children,
}: {
  interactive: boolean;
  dim: string;
  className: string;
  title?: string;
  children: ReactNode;
}) {
  if (interactive)
    return (
      <button type="button" data-dim={dim} title={title} className={`${className} text-left`}>
        {children}
      </button>
    );
  return (
    <div data-dim={dim} title={title} className={className}>
      {children}
    </div>
  );
}
