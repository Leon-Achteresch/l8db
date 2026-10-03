import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, ExternalLink, Eye, EyeOff, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { aiSetKey } from "@/lib/db/ai";

const EASE = [0.22, 1, 0.36, 1] as const;
const ICON_SWAP = { type: "spring", duration: 0.3, bounce: 0 } as const;
const SWAP = {
  initial: { opacity: 0, filter: "blur(4px)", transform: "translateY(4px)" },
  animate: {
    opacity: 1,
    filter: "blur(0px)",
    transform: "translateY(0px)",
    transition: { duration: 0.24, ease: EASE },
  },
  exit: {
    opacity: 0,
    filter: "blur(4px)",
    transform: "translateY(-4px)",
    transition: { duration: 0.14, ease: EASE },
  },
};

interface Props {
  profileId: string;
  stored: boolean;
  optional: boolean;
  keyUrl?: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
}
export function AiSettingsKeyField({
  profileId,
  stored,
  optional,
  keyUrl,
  onChanged,
  onError,
}: Props) {
  const id = useId();
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const apply = async (value: string) => {
    setSaving(true);
    try {
      await aiSetKey(profileId, value);
      await onChanged();
      setKey("");
      setVisible(false);
      setReplacing(false);
    } catch (error) {
      onError(String(error));
    } finally {
      setSaving(false);
    }
  };
  const sealed = stored && !replacing;
  return (
    <div className="space-y-2">
      <AnimatePresence mode="popLayout" initial={false}>
        {sealed ? (
          <motion.div
            key="sealed"
            {...SWAP}
            className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[0.07] py-1.5 pr-1.5 pl-2.5 ring-1 ring-emerald-500/20 ring-inset"
          >
            <motion.span
              initial={{ opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" }}
              animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
              transition={ICON_SWAP}
              className="grid size-6 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            >
              <ShieldCheck className="size-3.5" />
            </motion.span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono tracking-[0.2em] text-muted-foreground">
                ••••••••••••
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Im Schlüsselbund gespeichert
              </span>
            </span>
            <Button size="xs" variant="ghost" onClick={() => setReplacing(true)}>
              Ersetzen
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Schlüssel entfernen"
              title="Schlüssel entfernen"
              disabled={saving}
              onClick={() => void apply("")}
            >
              {saving ? <Loader2 className="animate-spin" /> : <Trash2 />}
            </Button>
          </motion.div>
        ) : (
          <motion.div key="form" {...SWAP} className="space-y-1">
            <label htmlFor={`${id}-key`} className="flex items-baseline justify-between gap-2">
              <span>API-Schlüssel</span>
              {optional && <span className="text-[11px] text-muted-foreground">optional</span>}
            </label>
            <div className="flex gap-1.5">
              <div className="relative min-w-0 flex-1">
                <Input
                  id={`${id}-key`}
                  aria-label="API-Schlüssel"
                  type={visible ? "text" : "password"}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Schlüssel einfügen"
                  className="pr-8 font-mono placeholder:font-sans"
                  value={key}
                  onChange={(event) => setKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && key.trim()) void apply(key.trim());
                    if (event.key === "Escape" && replacing) setReplacing(false);
                  }}
                />
                <button
                  type="button"
                  aria-label={visible ? "Schlüssel verbergen" : "Schlüssel anzeigen"}
                  aria-pressed={visible}
                  onClick={() => setVisible((value) => !value)}
                  className="absolute inset-y-0 right-0 grid w-8 place-items-center text-muted-foreground outline-none transition-colors duration-150 hover:text-foreground focus-visible:text-foreground"
                >
                  {visible ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
              </div>
              <Button
                size="sm"
                aria-label="Schlüssel speichern"
                disabled={!key.trim() || saving}
                onClick={() => void apply(key.trim())}
                className="relative min-w-[5.5rem]"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.span
                    key={saving ? "saving" : "idle"}
                    initial={{ opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" }}
                    animate={{ opacity: 1, transform: "scale(1)", filter: "blur(0px)" }}
                    exit={{ opacity: 0, transform: "scale(0.25)", filter: "blur(4px)" }}
                    transition={ICON_SWAP}
                    className="flex items-center gap-1"
                  >
                    {saving ? (
                      <Loader2 className="size-3.5 animate-spin" />
                    ) : (
                      <>
                        <Check className="size-3.5" />
                        Speichern
                      </>
                    )}
                  </motion.span>
                </AnimatePresence>
              </Button>
            </div>
            {replacing && (
              <button
                type="button"
                onClick={() => setReplacing(false)}
                className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Gespeicherten Schlüssel behalten
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {keyUrl && !sealed && (
        <button
          type="button"
          onClick={() => void openUrl(keyUrl).catch((error) => onError(String(error)))}
          className="flex items-center gap-1 text-[11px] text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-foreground hover:underline"
        >
          Noch keinen Schlüssel? Beim Anbieter erstellen
          <ExternalLink className="size-3" />
        </button>
      )}
    </div>
  );
}
