import { create } from "zustand";
import { persist } from "zustand/middleware";
import { syncAcrossWindows } from "@/lib/window-sync";

export interface EditorAiSettings {
  enabled: boolean;
  inline: boolean;
  inlineDelay: number;
  profileId: string;
  fastModel: string;
  codeLens: boolean;
  nextEdit: boolean;
  shareValues: boolean;
  validate: boolean;
}

export const EDITOR_AI_DEFAULTS: EditorAiSettings = {
  enabled: true,
  inline: true,
  inlineDelay: 300,
  profileId: "",
  fastModel: "",
  codeLens: true,
  nextEdit: true,
  shareValues: false,
  validate: true,
};

interface EditorAiState extends EditorAiSettings {
  update: (patch: Partial<EditorAiSettings>) => void;
  reset: () => void;
}

export const clampInlineDelay = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(1500, Math.max(100, Math.round(value)))
    : EDITOR_AI_DEFAULTS.inlineDelay;

export const useEditorAiSettings = create<EditorAiState>()(
  persist(
    (set) => ({
      ...EDITOR_AI_DEFAULTS,
      update: (patch) =>
        set(
          patch.inlineDelay === undefined
            ? patch
            : { ...patch, inlineDelay: clampInlineDelay(patch.inlineDelay) },
        ),
      reset: () => set(EDITOR_AI_DEFAULTS),
    }),
    {
      name: "l8db.ai.editor",
      version: 1,
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<EditorAiSettings>;
        const pick = <K extends keyof EditorAiSettings>(key: K) =>
          typeof saved[key] === typeof EDITOR_AI_DEFAULTS[key] ? saved[key] : current[key];
        return {
          ...current,
          enabled: pick("enabled") as boolean,
          inline: pick("inline") as boolean,
          inlineDelay: clampInlineDelay(saved.inlineDelay),
          profileId: pick("profileId") as string,
          fastModel: pick("fastModel") as string,
          codeLens: pick("codeLens") as boolean,
          nextEdit: pick("nextEdit") as boolean,
          shareValues: pick("shareValues") as boolean,
          validate: pick("validate") as boolean,
        };
      },
    },
  ),
);

syncAcrossWindows("l8db.ai.editor", () => void useEditorAiSettings.persist.rehydrate());
