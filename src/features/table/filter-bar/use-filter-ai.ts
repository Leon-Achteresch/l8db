import { useEffect, useRef, useState } from "react";
import { isAbort } from "@/lib/ai/editor/client";
import { useEditorAiMetrics } from "@/lib/ai/editor/metrics";
import { filterAiChanges, filterAiContextKey, filterAiHasChanges } from "@/lib/filter-ai/changes";
import { filterAiAvailability, runFilterAi } from "@/lib/filter-ai/run";
import type { FilterAiChange, FilterAiProposal } from "@/lib/filter-ai/types";
import type { FilterBarModel } from "./use-filter-bar-model";

export type FilterAiState =
  | { phase: "idle" }
  | { phase: "running"; prompt: string }
  | {
      phase: "preview";
      prompt: string;
      key: string;
      proposal: FilterAiProposal;
      changes: FilterAiChange[];
      changed: boolean;
    }
  | { phase: "error"; prompt: string; message: string };

function errorMessage(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).trim();
  return text.length > 400 ? `${text.slice(0, 400)}…` : text || "Unbekannter Fehler.";
}

export function useFilterAi(model: FilterBarModel) {
  const [state, setState] = useState<FilterAiState>({ phase: "idle" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const run = async (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    controller.current?.abort();
    const availability = filterAiAvailability();
    if (!availability.ok) {
      setState({ phase: "error", prompt: text, message: availability.reason });
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const context = model.aiContext();
    setState({ phase: "running", prompt: text });
    try {
      const proposal = await runFilterAi(context, text, abort.signal);
      if (abort.signal.aborted) return;
      const changes = filterAiChanges(context, proposal);
      setState({
        phase: "preview",
        prompt: text,
        key: filterAiContextKey(context),
        proposal,
        changes,
        changed: filterAiHasChanges(changes),
      });
    } catch (error) {
      if (abort.signal.aborted || isAbort(error)) return;
      setState({ phase: "error", prompt: text, message: errorMessage(error) });
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  };

  const cancel = () => {
    controller.current?.abort();
    controller.current = null;
    if (state.phase === "preview" && state.changed)
      useEditorAiMetrics.getState().outcome("filter", "rejected");
    setState({ phase: "idle" });
  };

  const accept = (): boolean => {
    if (state.phase !== "preview") return false;
    if (state.changed && filterAiContextKey(model.aiContext()) !== state.key) {
      setState({
        phase: "error",
        prompt: state.prompt,
        message:
          "Die Filter wurden während der KI-Anfrage geändert. Bitte die Anfrage erneut senden, damit nichts überschrieben wird.",
      });
      return false;
    }
    if (state.changed) {
      model.applyProposal(state.proposal);
      useEditorAiMetrics.getState().outcome("filter", "accepted");
    }
    setState({ phase: "idle" });
    return true;
  };

  return { state, run, cancel, accept };
}

export type FilterAi = ReturnType<typeof useFilterAi>;
