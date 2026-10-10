import { Check, PenLine } from "lucide-react";
import { useState } from "react";
import { bypassAiPermissions, modeOptions, thoughtLevel } from "@/lib/ai/context";
import { useAiStore } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";
import { cn } from "@/lib/utils";

interface Props {
  profile: AiProfile;
  models: AiModels;
  disabled: boolean;
}
export function AiModelOptions({ profile, models, disabled }: Props) {
  const [custom, setCustom] = useState(false);
  const customModel =
    custom || Boolean(profile.model && !models.models.some((model) => model.id === profile.model));
  const saveProfile = useAiStore((state) => state.saveProfile);
  const modes = modeOptions(models.modes);
  const options = (models.configOptions ?? []).filter((option): option is Record<string, unknown> =>
    Boolean(
      option &&
        typeof option === "object" &&
        !(
          "category" in option &&
          ["model", "mode", "thought_level"].includes(String(option.category))
        ) &&
        !("id" in option && ["model", "mode"].includes(String(option.id))),
    ),
  );
  const choiceOptions = (items: unknown): { id: string; name: string }[] => {
    if (!Array.isArray(items)) return [];
    return items.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const option = item as Record<string, unknown>;
      if (Array.isArray(option.options)) return choiceOptions(option.options);
      const id = option.value ?? option.id;
      return typeof id === "string"
        ? [{ id, name: String(option.name ?? option.label ?? id) }]
        : [];
    });
  };
  const selectClass =
    "h-8 w-full min-w-0 rounded-lg border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-2">
      <div
        role="radiogroup"
        aria-label="Modell auswählen"
        className="-mx-1 max-h-56 space-y-0.5 overflow-y-auto"
      >
        {[{ id: "", name: "Standardmodell" }, ...models.models].map((model) => {
          const checked = !customModel && profile.model === model.id;
          return (
            <button
              key={model.id}
              type="button"
              role="radio"
              aria-checked={checked}
              disabled={disabled}
              onClick={() => {
                setCustom(false);
                const level = thoughtLevel(models)?.id;
                const { [level ?? ""]: _, ...config } = profile.config ?? {};
                saveProfile({ ...profile, model: model.id, effort: "", config });
              }}
              className={cn(
                "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
                checked && "bg-muted font-medium",
              )}
            >
              <span className="min-w-0 flex-1 truncate">{model.name}</span>
              {checked && <Check className="size-3.5 shrink-0" />}
            </button>
          );
        })}
        <button
          type="button"
          role="radio"
          aria-checked={customModel}
          disabled={disabled}
          onClick={() => setCustom(true)}
          className={cn(
            "flex h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:bg-muted",
            customModel && "bg-muted text-foreground",
          )}
        >
          <PenLine className="size-3.5 shrink-0" />
          <span className="flex-1">Eigene Modell-ID …</span>
        </button>
      </div>
      {(!models.models.length || customModel) && (
        <input
          aria-label="Modell-ID"
          className={selectClass}
          placeholder="Modell-ID (optional)"
          disabled={disabled}
          value={profile.model}
          onChange={(event) => saveProfile({ ...profile, model: event.target.value })}
        />
      )}
      {(modes.length > 0 || options.length > 0) && (
        <details className="space-y-3 text-xs">
          <summary className="min-h-7 cursor-pointer py-1 text-muted-foreground">
            Weitere Modelloptionen
          </summary>
          {modes.length > 0 && (
            <select
              aria-label="Agent-Modus auswählen"
              className={selectClass}
              disabled={disabled}
              value={profile.mode}
              onChange={(event) => saveProfile({ ...profile, mode: event.target.value })}
            >
              <option value="">Modus: Standard</option>
              {modes.map((mode) => (
                <option key={mode.id} value={mode.id}>
                  {mode.name}
                </option>
              ))}
            </select>
          )}
          {options.map((option) => {
            const id = String(option.id);
            const choices = choiceOptions(option.options).filter(
              (choice) => !bypassAiPermissions(choice.id, option.category === "mode" ? "mode" : id),
            );
            if (!choices.length) return null;
            return (
              <label key={id} className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>{String(option.name ?? id)}</span>
                <select
                  aria-label={String(option.name ?? id)}
                  className={selectClass}
                  disabled={disabled}
                  value={String(profile.config?.[id] ?? option.currentValue ?? "")}
                  onChange={(event) =>
                    saveProfile({
                      ...profile,
                      config: { ...profile.config, [id]: event.target.value },
                    })
                  }
                >
                  <option value="">Standard</option>
                  {choices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              </label>
            );
          })}
        </details>
      )}
    </div>
  );
}
