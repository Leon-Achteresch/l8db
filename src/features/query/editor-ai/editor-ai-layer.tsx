import { useSyncExternalStore } from "react";
import type { EditorAiController } from "@/lib/ai/editor/controller";
import { EditorAiSessionView } from "./editor-ai-session-view";

const noop = () => () => {};

export function EditorAiLayer({ controller }: { controller: EditorAiController | null }) {
  const session = useSyncExternalStore(
    controller?.subscribe ?? noop,
    () => controller?.getSession() ?? null,
  );
  return session ? <EditorAiSessionView key={session.id} session={session} /> : null;
}
