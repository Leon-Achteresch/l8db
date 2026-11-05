import { Pencil } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AiMessage } from "@/lib/db/ai";
import { cn } from "@/lib/utils";
import { AiAttachmentChips } from "./ai-attachment-chips";
import { AiBranchSwitcher } from "./ai-branch-switcher";
import { AiCopyAction } from "./ai-copy-action";
import { AiMessageTime } from "./ai-message-time";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiUserMessage({
  message,
  siblings,
  disabled,
  onEdit,
  onBranch,
}: {
  message: AiMessage;
  siblings?: (string | undefined)[];
  disabled: boolean;
  onEdit: (message: AiMessage, text: string) => void;
  onBranch: (id: string | undefined) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
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
        className="w-full rounded-2xl bg-muted/70 p-2 focus-within:bg-muted"
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
  const long = message.text.length > 600 || message.text.split("\n").length > 8;
  return (
    <article
      data-slot="message"
      data-from="user"
      aria-label="Deine Nachricht"
      className="group/message relative flex flex-col items-end gap-1.5 pl-10"
    >
      {message.attachments?.length ? <AiAttachmentChips files={message.attachments} /> : null}
      {message.contextLabels?.length ? (
        <p className="text-[11px] text-muted-foreground" title="Mitgeschickter Kontext">
          {message.contextLabels.join(" · ")}
        </p>
      ) : null}
      <div className="max-w-full rounded-[20px] rounded-br-md bg-foreground/[0.06] px-3.5 py-2 dark:bg-muted">
        <div
          className={cn(
            "whitespace-pre-wrap break-words text-[14px] leading-relaxed text-foreground",
            long &&
              !expanded &&
              "max-h-44 overflow-hidden [mask-image:linear-gradient(to_bottom,black_calc(100%-1.75rem),transparent)]",
          )}
        >
          {message.text}
        </div>
        {long && (
          <Button
            size="sm"
            variant="ghost"
            className="-ml-2 mt-1 h-6 px-2 text-xs text-muted-foreground"
            onClick={() => setExpanded(!expanded)}
          >
            {expanded ? "Weniger" : "Alles anzeigen"}
          </Button>
        )}
      </div>
      <div className="-mt-1 -mr-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
        <AiMessageTime at={message.createdAt} />
        <ResponseAction
          label="Nachricht bearbeiten"
          disabled={disabled}
          onClick={() => setDraft(message.text)}
        >
          <Pencil className="size-3.5" />
        </ResponseAction>
        <AiCopyAction text={message.text} label="Nachricht kopieren" />
        <AiBranchSwitcher
          siblings={siblings}
          id={message.id}
          disabled={disabled}
          onBranch={onBranch}
        />
      </div>
    </article>
  );
}
