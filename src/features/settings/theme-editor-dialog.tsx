import { CopyIcon, DownloadIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ColorSchemePreview } from "@/features/settings/color-scheme-preview";
import { ThemeVariantFields } from "@/features/settings/theme-variant-fields";
import { isAbort } from "@/lib/ai/editor/client";
import type { AppTheme, ThemeMode } from "@/lib/app-themes";
import { copyText } from "@/lib/clipboard";
import { useSettingsStore } from "@/lib/settings";
import { runThemeAi, THEME_AI_MAX_PROMPT, themeAiAvailable } from "@/lib/theme-ai";
import { pickAndWriteTheme, themeAiPrompt } from "@/lib/theme-file";

type Props = {
  themeId: string | null;
  onClose: () => void;
};

export function ThemeEditorDialog({ themeId, onClose }: Props) {
  const stored = useSettingsStore((state) =>
    state.customThemes.find((theme) => theme.id === themeId),
  );
  const saveCustomTheme = useSettingsStore((state) => state.saveCustomTheme);
  const deleteCustomTheme = useSettingsStore((state) => state.deleteCustomTheme);
  const { resolvedTheme } = useTheme();
  const [mode, setMode] = useState<ThemeMode>(resolvedTheme === "dark" ? "dark" : "light");
  const [draft, setDraft] = useState<AppTheme | undefined>(stored);
  const [wish, setWish] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const abort = useRef<AbortController>(undefined);
  const pending = useRef<AppTheme>(undefined);

  useEffect(() => {
    if (stored?.id === draft?.id) return;
    clearTimeout(timer.current);
    pending.current = undefined;
    setDraft(stored);
  }, [stored, draft?.id]);

  const flush = () => {
    clearTimeout(timer.current);
    if (pending.current) saveCustomTheme(pending.current);
    pending.current = undefined;
  };

  useEffect(
    () => () => {
      abort.current?.abort();
      clearTimeout(timer.current);
      if (pending.current) useSettingsStore.getState().saveCustomTheme(pending.current);
    },
    [],
  );

  const update = (next: AppTheme) => {
    setDraft(next);
    pending.current = next.name.trim() ? next : { ...next, name: "Eigenes Theme" };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 120);
  };

  const close = () => {
    abort.current?.abort();
    flush();
    onClose();
  };

  const generate = async () => {
    if (!draft || !wish.trim()) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    try {
      const result = await runThemeAi(wish, controller.signal);
      update({ ...result, id: draft.id });
    } catch (error) {
      if (!isAbort(error)) toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (abort.current === controller) setBusy(false);
    }
  };

  const copyPrompt = async () => {
    await copyText(themeAiPrompt(wish), "KI-Prompt kopiert").catch(() => undefined);
  };

  const exportTheme = async () => {
    if (!draft) return;
    try {
      const path = await pickAndWriteTheme(draft);
      if (path) toast.success("Theme exportiert");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    }
  };

  const aiReady = themeAiAvailable();

  return (
    <Dialog open={Boolean(themeId && draft)} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-h-[88svh] gap-5 overflow-y-auto sm:max-w-3xl">
        {draft ? (
          <>
            <DialogTitle className="sr-only">Theme bearbeiten</DialogTitle>
            <div className="flex items-center gap-3 pr-8">
              <Input
                value={draft.name}
                aria-label="Theme-Name"
                maxLength={60}
                onChange={(event) => update({ ...draft, name: event.target.value })}
                onBlur={() => !draft.name.trim() && update({ ...draft, name: "Eigenes Theme" })}
                className="h-9 border-transparent bg-muted/40 text-base font-semibold shadow-none"
              />
              <Tabs value={mode} onValueChange={(value) => setMode(value as ThemeMode)}>
                <TabsList>
                  <TabsTrigger value="light">Hell</TabsTrigger>
                  <TabsTrigger value="dark">Dunkel</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
            <ColorSchemePreview
              mode={mode}
              variant={draft[mode]}
              className="aspect-[16/5] overflow-hidden rounded-lg"
            />
            <div className="flex items-center gap-2">
              <Input
                value={wish}
                maxLength={THEME_AI_MAX_PROMPT}
                placeholder="z. B. Nord-Stil, kühles Blau, wenig Sättigung"
                aria-label="Theme mit KI beschreiben"
                onChange={(event) => setWish(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && aiReady && void generate()}
                className="h-8 flex-1"
              />
              {aiReady ? (
                <Button size="sm" disabled={busy || !wish.trim()} onClick={() => void generate()}>
                  {busy ? <Spinner /> : <SparklesIcon />}
                  Mit KI erstellen
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                title="Prompt für eine externe KI kopieren"
                onClick={() => void copyPrompt()}
              >
                <CopyIcon />
                Prompt
              </Button>
            </div>
            <ThemeVariantFields
              variant={draft[mode]}
              onChange={(variant) => update({ ...draft, [mode]: variant })}
            />
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  clearTimeout(timer.current);
                  pending.current = undefined;
                  deleteCustomTheme(draft.id);
                  onClose();
                }}
              >
                <Trash2Icon />
                Löschen
              </Button>
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => void exportTheme()}>
                  <DownloadIcon />
                  Exportieren
                </Button>
                <Button onClick={close}>Fertig</Button>
              </div>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
