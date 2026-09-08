import { create } from "zustand";
import type { Json, PromptKind, PromptRequest, PromptResult } from "./contracts";

export interface ActivePrompt extends PromptRequest {
  promptId: string;
}

const resolvers = new Map<string, (value: Json | undefined) => void>();

interface PromptsState {
  pending: ActivePrompt[];
  request<T extends PromptKind>(request: PromptRequest & { kind: T }): Promise<PromptResult<T>>;
  resolve(promptId: string, value: Json | undefined): void;
}

export const useExtensionPrompts = create<PromptsState>()((set) => ({
  pending: [],
  request(request) {
    const promptId = crypto.randomUUID();
    const pending: ActivePrompt = { ...request, promptId };
    const result = new Promise<Json | undefined>((resolve) => {
      resolvers.set(promptId, resolve);
    });
    set((state) => ({ pending: [...state.pending, pending] }));
    return result as Promise<never>;
  },
  resolve(promptId, value) {
    set((state) => ({ pending: state.pending.filter((entry) => entry.promptId !== promptId) }));
    resolvers.get(promptId)?.(value);
    resolvers.delete(promptId);
  },
}));

export function resolveExtensionPrompt(promptId: string, value: Json | undefined) {
  useExtensionPrompts.getState().resolve(promptId, value);
}
