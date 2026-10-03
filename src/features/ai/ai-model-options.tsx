import { useState } from "react";
import { bypassAiPermissions, modeOptions } from "@/lib/ai/context";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import type { AiModels, AiProfile } from "@/lib/db/ai";

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
  const rawEfforts = models.models.find((model) => model.id === profile.model)?.efforts ?? [];
  const efforts = rawEfforts.flatMap((value) => {
    if (typeof value === "string") return [value];
    if (
      value &&
      typeof value === "object" &&
      "reasoningEffort" in value &&
      typeof value.reasoningEffort === "string"
    )
      return [value.reasoningEffort];
    return [];
  });
  if (!AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli && !efforts.length)
    efforts.push("low", "medium", "high");
  const modes = modeOptions(models.modes);
  const options = (models.configOptions ?? []).filter((option): option is Record<string, unknown> =>
    Boolean(
      option &&
        typeof option === "object" &&
        !("category" in option && ["model", "mode"].includes(String(option.category))) &&
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
    "h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <div className="space-y-3">
      <select
        aria-label="Modell auswählen"
        disabled={disabled}
        className={selectClass}
        value={customModel ? "__custom__" : profile.model}
        onChange={(event) => {
          if (event.target.value === "__custom__") {
            setCustom(true);
            return;
          }
          setCustom(false);
          saveProfile({ ...profile, model: event.target.value, effort: "" });
        }}
      >
        <option value="">Standardmodell</option>
        {models.models.map((model) => (
          <option key={model.id} value={model.id}>
            {model.name}
          </option>
        ))}
        <option value="__custom__">Eigene Modell-ID …</option>
      </select>
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
      {(efforts.length > 0 || modes.length > 0 || options.length > 0) && (
        <details className="space-y-3 text-xs">
          <summary className="min-h-7 cursor-pointer py-1 text-muted-foreground">
            Weitere Modelloptionen
          </summary>
          {efforts.length > 0 && (
            <select
              aria-label="Reasoning auswählen"
              className={selectClass}
              disabled={disabled}
              value={profile.effort}
              onChange={(event) => saveProfile({ ...profile, effort: event.target.value })}
            >
              <option value="">Reasoning: Automatisch</option>
              {efforts.map((effort) => (
                <option key={effort} value={effort}>
                  {effort}
                </option>
              ))}
            </select>
          )}
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
