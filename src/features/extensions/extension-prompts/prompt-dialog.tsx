import type { ActivePrompt } from "@/lib/extensions/prompts";
import { InputBoxDialog } from "./input-box-dialog";
import { MessageDialog } from "./message-dialog";
import { QuickPickDialog } from "./quick-pick-dialog";

export function PromptDialog({
  prompt,
  resolve,
}: {
  prompt: ActivePrompt;
  resolve: (id: string, value: never) => void;
}) {
  if (prompt.kind === "quickPick") return <QuickPickDialog prompt={prompt} resolve={resolve} />;
  if (prompt.kind === "inputBox") return <InputBoxDialog prompt={prompt} resolve={resolve} />;
  return <MessageDialog prompt={prompt} resolve={resolve} />;
}
