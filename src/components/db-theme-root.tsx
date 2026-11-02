import { useTheme } from "next-themes";
import { type ReactNode, useEffect } from "react";
import { appTheme, appThemeCssVars } from "@/lib/app-themes";
import { detectProvider } from "@/lib/connection-url";
import { useActiveConnection } from "@/lib/connections";
import { resolveDbTheme, useDbThemeStore } from "@/lib/db-theme";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function DbThemeRoot({ children, className }: { children: ReactNode; className?: string }) {
  const connection = useActiveConnection();
  const previewKind = useDbThemeStore((state) => state.previewKind);
  const previewProvider = useDbThemeStore((state) => state.previewProvider);
  const kind = previewKind ?? connection?.kind ?? "postgres";
  const providerId =
    previewProvider ??
    (connection ? detectProvider(connection.connectionString, connection.kind) : null);
  const { resolvedTheme } = useTheme();
  const mode = resolvedTheme === "dark" ? "dark" : "light";
  const themeId = useSettingsStore((state) =>
    mode === "dark" ? state.darkTheme : state.lightTheme,
  );
  const dbThemes = useSettingsStore((state) => state.dbThemes);

  useEffect(() => {
    const vars = appThemeCssVars(
      appTheme(themeId)[mode],
      dbThemes || previewKind ? resolveDbTheme(kind, providerId) : null,
    );
    const root = document.documentElement;
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
  }, [kind, providerId, mode, themeId, dbThemes, previewKind]);

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
