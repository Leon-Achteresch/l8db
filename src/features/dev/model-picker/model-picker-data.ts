export interface LabModel {
  id: string;
  name: string;
  hint: string;
  speed: number;
  smarts: number;
  context: string;
  badge?: "Neu" | "Schnell" | "Günstig";
}

export interface LabProvider {
  id: string;
  name: string;
  short: string;
  cli: boolean;
  models: LabModel[];
}

export interface LabSelection {
  provider: string;
  model: string;
  effort: string;
}

export const LAB_EFFORTS = [
  { id: "low", name: "Niedrig" },
  { id: "medium", name: "Mittel" },
  { id: "high", name: "Hoch" },
  { id: "max", name: "Max" },
];

export const LAB_PROVIDERS: LabProvider[] = [
  {
    id: "claude",
    name: "Claude Code",
    short: "Claude",
    cli: true,
    models: [
      {
        id: "opus-5-5",
        name: "Opus 5.5",
        hint: "Komplexe Migrationen",
        speed: 2,
        smarts: 3,
        context: "1M",
        badge: "Neu",
      },
      { id: "sonnet-5-5", name: "Sonnet 5.5", hint: "Alltag", speed: 3, smarts: 3, context: "1M" },
      {
        id: "haiku-5-5",
        name: "Haiku 5.5",
        hint: "Kurze Fragen",
        speed: 3,
        smarts: 2,
        context: "200k",
        badge: "Schnell",
      },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    short: "Codex",
    cli: true,
    models: [
      {
        id: "gpt-6.2-sol",
        name: "GPT-6.2-Sol",
        hint: "Coding & Alltag",
        speed: 3,
        smarts: 3,
        context: "400k",
      },
      {
        id: "gpt-6.2-astra",
        name: "GPT-6.2-Astra",
        hint: "Komplexe Aufgaben",
        speed: 2,
        smarts: 3,
        context: "400k",
        badge: "Neu",
      },
      {
        id: "gpt-6.1-terra",
        name: "GPT-6.1 Terra",
        hint: "Effizient",
        speed: 3,
        smarts: 2,
        context: "400k",
      },
      {
        id: "gpt-6-luna",
        name: "GPT-6-Luna",
        hint: "Einfache Aufgaben",
        speed: 3,
        smarts: 1,
        context: "400k",
        badge: "Günstig",
      },
    ],
  },
  {
    id: "gemini-cli",
    name: "Gemini CLI",
    short: "Gemini",
    cli: true,
    models: [
      {
        id: "gemini-3-pro",
        name: "Gemini 3 Pro",
        hint: "Große Schemas",
        speed: 2,
        smarts: 3,
        context: "2M",
      },
      {
        id: "gemini-3-flash",
        name: "Gemini 3 Flash",
        hint: "Schnelle Antworten",
        speed: 3,
        smarts: 2,
        context: "1M",
        badge: "Schnell",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI · API",
    short: "OpenAI",
    cli: false,
    models: [
      { id: "gpt-5", name: "GPT-5", hint: "Allrounder", speed: 2, smarts: 3, context: "400k" },
      {
        id: "gpt-5-nano",
        name: "GPT-5 nano",
        hint: "Sehr günstig",
        speed: 3,
        smarts: 1,
        context: "128k",
        badge: "Günstig",
      },
    ],
  },
  {
    id: "anthropic",
    name: "Anthropic · API",
    short: "Anthropic",
    cli: false,
    models: [
      {
        id: "api-opus-5-5",
        name: "Opus 5.5",
        hint: "Tiefe Analyse",
        speed: 2,
        smarts: 3,
        context: "1M",
      },
      {
        id: "api-sonnet-5-5",
        name: "Sonnet 5.5",
        hint: "Alltag",
        speed: 3,
        smarts: 3,
        context: "1M",
      },
    ],
  },
  {
    id: "ollama",
    name: "Ollama · Lokal",
    short: "Ollama",
    cli: false,
    models: [
      {
        id: "qwen3-coder",
        name: "qwen3-coder:30b",
        hint: "Offline",
        speed: 2,
        smarts: 2,
        context: "256k",
      },
      { id: "llama4", name: "llama4:scout", hint: "Offline", speed: 2, smarts: 1, context: "128k" },
    ],
  },
];

export const LAB_DEFAULT: LabSelection = {
  provider: "claude",
  model: "sonnet-5-5",
  effort: "medium",
};

export function labLookup(selection: LabSelection) {
  const provider =
    LAB_PROVIDERS.find((entry) => entry.id === selection.provider) ?? LAB_PROVIDERS[0];
  const model = provider.models.find((entry) => entry.id === selection.model) ?? provider.models[0];
  return { provider, model };
}
