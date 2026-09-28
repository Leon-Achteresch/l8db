import { lazy, Suspense } from "react";
import { useExtensionPrompts } from "@/lib/extensions/prompts";

const PromptDialog = lazy(() =>
  import("./extension-prompts/prompt-dialog").then(({ PromptDialog }) => ({
    default: PromptDialog,
  })),
);

export function ExtensionPrompts() {
  const pending = useExtensionPrompts((state) => state.pending);
  const resolve = useExtensionPrompts((state) => state.resolve);
  return (
    <>
      {pending.length > 0 && (
        <Suspense fallback={null}>
          {pending.map((prompt) => (
            <PromptDialog key={prompt.promptId} prompt={prompt} resolve={resolve} />
          ))}
        </Suspense>
      )}
    </>
  );
}
