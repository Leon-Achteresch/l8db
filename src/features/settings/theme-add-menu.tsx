import { ClipboardPasteIcon, CopyIcon, FileUpIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type AppTheme, appTheme, MAX_CUSTOM_THEMES, newCustomThemeId } from "@/lib/app-themes";
import { copyText, pasteText } from "@/lib/clipboard";
import { useSettingsStore } from "@/lib/settings";
import { parseThemeFile, pickAndReadTheme, themeAiPrompt } from "@/lib/theme-file";

type Props = {
  onCreated: (id: string) => void;
};

export function ThemeAddMenu({ onCreated }: Props) {
  const full = useSettingsStore((state) => state.customThemes.length >= MAX_CUSTOM_THEMES);

  const add = (theme: AppTheme) => {
    const store = useSettingsStore.getState();
    if (!store.saveCustomTheme(theme))
      throw new Error(`Höchstens ${MAX_CUSTOM_THEMES} eigene Themes möglich.`);
    store.setLightTheme(theme.id);
    store.setDarkTheme(theme.id);
    onCreated(theme.id);
  };

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const createBlank = () =>
    void run(async () => {
      const state = useSettingsStore.getState();
      const light = appTheme(state.lightTheme, state.customThemes).light;
      const dark = appTheme(state.darkTheme, state.customThemes).dark;
      add({
        id: newCustomThemeId(),
        name: "Eigenes Theme",
        light: structuredClone(light),
        dark: structuredClone(dark),
        custom: true,
      });
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={full}
        aria-label="Eigenes Theme hinzufügen"
        className="flex h-full min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl bg-muted/40 p-3 text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <PlusIcon className="size-5" />
        <span className="text-sm font-medium">Eigenes Theme</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={createBlank}>
          <PlusIcon />
          Neu erstellen
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() =>
            void run(async () => {
              const theme = await pickAndReadTheme();
              if (theme) add(theme);
            })
          }
        >
          <FileUpIcon />
          Datei importieren
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => void run(async () => add(parseThemeFile(await pasteText())))}
        >
          <ClipboardPasteIcon />
          Aus Zwischenablage
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() =>
            void run(async () => {
              await copyText(themeAiPrompt(""), "KI-Prompt kopiert");
            })
          }
        >
          <CopyIcon />
          KI-Prompt kopieren
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
