import { useExtensionPrompts } from "@/lib/extensions/prompts";
import { PromptDialog } from "./extension-prompts/prompt-dialog";

export function ExtensionPrompts() {
  const pending = useExtensionPrompts((state) => state.pending);
  const resolve = useExtensionPrompts((state) => state.resolve);
  return (
    <>
      {pending.map((prompt) => (
        <PromptDialog key={prompt.promptId} prompt={prompt} resolve={resolve} />
      ))}
    </>
  );
}
