import { PencilIcon } from "lucide-react";
import { useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { ThemeAddMenu } from "@/features/settings/theme-add-menu";
import { ThemeEditorDialog } from "@/features/settings/theme-editor-dialog";
import { ThemeSwatchButton } from "@/features/settings/theme-swatch-button";
import { APP_THEMES } from "@/lib/app-themes";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function SettingsAppThemes() {
  const lightTheme = useSettingsStore((state) => state.lightTheme);
  const darkTheme = useSettingsStore((state) => state.darkTheme);
  const dbThemes = useSettingsStore((state) => state.dbThemes);
  const setLightTheme = useSettingsStore((state) => state.setLightTheme);
  const setDarkTheme = useSettingsStore((state) => state.setDarkTheme);
  const customThemes = useSettingsStore((state) => state.customThemes);
  const [editing, setEditing] = useState<string | null>(null);
  const customBadge = useNewFeatureVisibility<HTMLDivElement>("settings.appearance.themes.custom");
  return (
    <div className="w-full space-y-2">
      {dbThemes ? (
        <p className="text-xs text-muted-foreground">
          Datenbank-Themes sind aktiv: Die Akzentfarbe folgt der Datenbank, das Theme bestimmt die
          Flächentönung.
        </p>
      ) : null}
      <div className="grid w-full grid-cols-1 gap-3 @min-[30rem]:grid-cols-2 @min-[56rem]:grid-cols-3">
        {[...APP_THEMES, ...customThemes].map((theme) => {
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
              <div className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{theme.name}</span>
                {theme.custom ? (
                  <button
                    type="button"
                    aria-label={`${theme.name} bearbeiten`}
                    onClick={() => setEditing(theme.id)}
                    className="flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <PencilIcon className="size-3.5" />
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
        <div ref={customBadge.ref} className="relative">
          {customBadge.isNew ? <NewBadge className="absolute top-2 right-2 z-10" /> : null}
          <ThemeAddMenu onCreated={setEditing} />
        </div>
      </div>
      <ThemeEditorDialog
        key={editing ?? "none"}
        themeId={editing}
        onClose={() => setEditing(null)}
      />
    </div>
  );
}
