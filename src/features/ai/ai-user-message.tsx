import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AiSession } from "@/lib/ai/store";
import type { AiMessage } from "@/lib/db/ai";
import { AiBranchSwitcher } from "./ai-branch-switcher";
import { AiCopyAction } from "./ai-copy-action";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiUserMessage({
  message,
  session,
  disabled,
  onEdit,
  onBranch,
}: {
  message: AiMessage;
  session?: AiSession;
  disabled: boolean;
  onEdit: (message: AiMessage, text: string) => void;
  onBranch: (id: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const editing = draft !== null;
  useEffect(() => {
    if (!editing || !area.current) return;
    area.current.focus();
    area.current.setSelectionRange(area.current.value.length, area.current.value.length);
  }, [editing]);
  const save = () => {
    if (!draft?.trim() || disabled) return;
    onEdit(message, draft);
    setDraft(null);
  };
  if (draft !== null)
    return (
      <form
        className="ml-auto w-full max-w-[85%] rounded-2xl border bg-background p-2 focus-within:border-foreground/25"
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <textarea
          aria-label="Bearbeitete Nachricht"
          value={draft}
          rows={Math.min(8, Math.max(2, draft.split("\n").length))}
          ref={area}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setDraft(null);
            } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              save();
            }
          }}
          className="block w-full resize-none bg-transparent px-1.5 py-1 text-sm leading-6 outline-none"
        />
        <div className="mt-1 flex items-center justify-end gap-1.5">
          <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
            Abbrechen
          </Button>
          <Button type="submit" size="sm" disabled={disabled || !draft.trim()}>
            Senden
          </Button>
        </div>
      </form>
    );
  return (
    <article
      data-slot="message"
      data-from="user"
      aria-label="Deine Nachricht"
      className="group/message flex flex-col items-end"
    >
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-muted px-3.5 py-2 text-sm leading-6">
        {message.text}
      </div>
      <div className="mt-0.5 -mr-1.5 flex items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100">
        <AiBranchSwitcher
          session={session}
          id={message.id}
          disabled={disabled}
          onBranch={onBranch}
        />
        <AiCopyAction text={message.text} label="Nachricht kopieren" />
        <ResponseAction
          label="Nachricht bearbeiten"
          disabled={disabled}
          onClick={() => setDraft(message.text)}
        >
          <Pencil className="size-3.5" />
        </ResponseAction>
      </div>
    </article>
  );
}
