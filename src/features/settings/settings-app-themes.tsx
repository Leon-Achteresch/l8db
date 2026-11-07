import { ThemeSwatchButton } from "@/features/settings/theme-swatch-button";
import { APP_THEMES } from "@/lib/app-themes";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function SettingsAppThemes() {
  const lightTheme = useSettingsStore((state) => state.lightTheme);
  const darkTheme = useSettingsStore((state) => state.darkTheme);
  const dbThemes = useSettingsStore((state) => state.dbThemes);
  const setLightTheme = useSettingsStore((state) => state.setLightTheme);
  const setDarkTheme = useSettingsStore((state) => state.setDarkTheme);
  return (
    <div className="w-full space-y-2">
      {dbThemes ? (
        <p className="text-xs text-muted-foreground">
          Datenbank-Themes sind aktiv: Die Akzentfarbe folgt der Datenbank, das Theme bestimmt die
          Flächentönung.
        </p>
      ) : null}
      <div className="grid w-full grid-cols-1 gap-3 @min-[30rem]:grid-cols-2 @min-[56rem]:grid-cols-3">
        {APP_THEMES.map((theme) => {
          const active = theme.id === lightTheme || theme.id === darkTheme;
          return (
            <div
              key={theme.id}
              data-app-theme={theme.id}
              className={cn(
                "flex flex-col gap-3 rounded-xl border bg-card p-3",
                active ? "border-primary/50" : "border-border",
              )}
            >
              <div className="flex justify-center gap-4 pt-1">
                <ThemeSwatchButton
                  mode="light"
                  variant={theme.light}
                  themeName={theme.name}
                  selected={theme.id === lightTheme}
                  onSelect={() => setLightTheme(theme.id)}
                />
                <ThemeSwatchButton
                  mode="dark"
                  variant={theme.dark}
                  themeName={theme.name}
                  selected={theme.id === darkTheme}
                  onSelect={() => setDarkTheme(theme.id)}
                />
              </div>
              <span className="text-sm font-medium">{theme.name}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
