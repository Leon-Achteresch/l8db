import { useEffect, useState } from "react";
import { AI_PROVIDERS, useAiStore } from "@/lib/ai/store";
import {
  type AiProfile,
  type AiStatus,
  aiApprove,
  aiCancel,
  aiEnvironment,
  aiRun,
  aiStatus,
} from "@/lib/db/ai";

export function aiReady(profile: AiProfile, status: AiStatus | null): boolean {
  if (!status) return false;
  if (AI_PROVIDERS.find((entry) => entry.id === profile.provider)?.cli) return status.installed;
  if (profile.provider === "ollama" || profile.provider === "lmstudio") return status.installed;
  return status.keyStored || (profile.provider === "compatible" && Boolean(profile.endpoint));
}

export function useAiSetupNeeded(active: boolean) {
  const [needed, setNeeded] = useState(false);
  const [readyIds, setReadyIds] = useState<string[]>([]);
  useEffect(() => {
    if (!active) return;
    let live = true;
    const { profiles } = useAiStore.getState();
    void Promise.all(
      profiles.map((profile) =>
        aiStatus(profile)
          .then((status) => aiReady(profile, status))
          .catch(() => false),
      ),
    ).then((ready) => {
      if (!live) return;
      setNeeded(!ready.some(Boolean));
      setReadyIds(profiles.filter((_, index) => ready[index]).map((profile) => profile.id));
    });
    return () => {
      live = false;
    };
  }, [active]);
  return [needed, setNeeded, readyIds] as const;
}

export async function aiCheck(profile: AiProfile, timeoutMs = 90_000): Promise<string> {
  const { cwd } = await aiEnvironment();
  const runId = crypto.randomUUID();
  let text = "";
  let error = "";
  let model = profile.model;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void aiCancel(runId).catch(() => undefined);
  }, timeoutMs);
  try {
    await aiRun(
      {
        runId,
        profile: { ...profile, approval: "" },
        cwd,
        sessionId: null,
        messages: [{ role: "user", text: "Antworte nur mit dem Wort OK." }],
        connections: [],
        activeId: null,
        skills: [],
        servers: [],
        allowWrites: false,
        allowDdl: false,
        attachments: [],
      },
      (event) => {
        if (event.kind === "text") text += String(event.data.delta ?? "");
        else if (event.kind === "error") error = String(event.data.message ?? "");
        else if (event.kind === "metadata" && typeof event.data.model === "string")
          model = event.data.model;
        else if (event.kind === "approval" || event.kind === "input")
          void aiApprove(runId, String(event.data.id), false).catch(() => undefined);
      },
    );
  } catch (failure) {
    error ||= String(failure);
  } finally {
    clearTimeout(timer);
  }
  if (timedOut) throw new Error("Keine Antwort innerhalb von 90 Sekunden.");
  if (error) throw new Error(error);
  if (!text.trim()) throw new Error("Keine Antwort erhalten. Anmeldung und Modell prüfen.");
  return model;
}
