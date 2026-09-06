import { useActiveConnection } from "@/lib/connections";
import { detectProvider } from "@/lib/connection-url";
import { resolveDbTheme, themeCssVars, useDbThemeStore } from "@/lib/db-theme";
import { cn } from "@/lib/utils";
import { useEffect, type ReactNode } from "react";

export function DbThemeRoot({ children, className }: { children: ReactNode; className?: string }) {
  const connection = useActiveConnection();
  const previewKind = useDbThemeStore((state) => state.previewKind);
  const previewProvider = useDbThemeStore((state) => state.previewProvider);
  const kind = previewKind ?? connection?.kind ?? "postgres";
  const providerId =
    previewProvider ??
    (connection ? detectProvider(connection.connectionString, connection.kind) : null);

  useEffect(() => {
    const vars = themeCssVars(resolveDbTheme(kind, providerId));
    const root = document.documentElement;
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }, [kind, providerId]);

  return (
    <div
      data-db-kind={kind}
      data-db-provider={providerId ?? kind}
      className={cn("db-theme flex min-h-0 min-w-0 flex-1 flex-col", className)}
    >
      {children}
    </div>
  );
}
