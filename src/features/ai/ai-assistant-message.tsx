import { Brain, CircleAlert, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { interleaveAiRich } from "@/lib/ai/rich";
import type { AiSession } from "@/lib/ai/store";
import type { AiMessage } from "@/lib/db/ai";
import { useSettingsStore } from "@/lib/settings";
import { AiAnswer } from "./ai-answer";
import { AiBranchSwitcher } from "./ai-branch-switcher";
import { AiCopyAction } from "./ai-copy-action";
import { AiMessageTime } from "./ai-message-time";
import { AiRichContent } from "./ai-rich-content";
import { AiTurnHeader } from "./ai-turn-header";
import { AiWorkRow } from "./ai-work-row";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiAssistantMessage({
  message,
  session,
  streaming,
  status,
  disabled,
  onRetry,
  onBranch,
}: {
  message: AiMessage;
  session?: AiSession;
  streaming: boolean;
  status: string;
  disabled: boolean;
  onRetry: (message: AiMessage) => void;
  onBranch: (id: string | undefined) => void;
}) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const [open, setOpen] = useState(false);
  const showWork = !easyMode || open;
  const parts = interleaveAiRich(message.text, message.rich);
  const work = message.rich?.filter((block) => block.type === "tool" || block.type === "decision");
  const hasWork = Boolean(message.reasoning || work?.length);
  const toolRunning = work?.some((block) => block.type === "tool" && block.status === "running");
  const thinking = streaming && !message.text && !work?.length;
  const waiting = streaming && !parts[parts.length - 1].text.trim() && !toolRunning;
  const thought = message.reasoning
    ?.split("\n")
    .find((line) => line.trim())
    ?.replace(/[*_`#>]/g, "")
    .trim()
    .slice(0, 200);
  return (
    <article
      data-slot="message"
      data-from="assistant"
      aria-label="Antwort"
      aria-busy={streaming}
      className="group/message min-w-0 space-y-2 px-1 py-0.5"
    >
      {(streaming || message.stopped || (hasWork && message.durationMs !== undefined)) && (
        <AiTurnHeader
          streaming={streaming}
          startedAt={message.createdAt}
          durationMs={message.durationMs}
          stopped={message.stopped}
          open={open}
          onToggle={easyMode && hasWork ? () => setOpen(!open) : undefined}
        />
      )}
      {showWork && message.reasoning && (
        <AiWorkRow
          icon={Brain}
          active={thinking}
          label={thinking ? "Denkt nach" : thought || "Gedacht"}
          detail={message.reasoning}
        />
      )}
      {parts.map((part, index) => (
        <Fragment key={String(index)}>
          {part.text.trim() ? (
            <AiAnswer text={part.text} streaming={streaming && index === parts.length - 1} />
          ) : null}
          {part.blocks.length ? (
            <AiRichContent blocks={part.blocks} running={streaming} showWork={showWork} />
          ) : null}
        </Fragment>
      ))}
      {waiting && !(thinking && message.reasoning) && (
        <AiWorkRow icon={Brain} active label={status || "Denkt nach"} />
      )}
      {message.error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-md border border-destructive/25 bg-destructive/5 px-2.5 py-1.5 text-xs"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/80">
            {message.error}
          </p>
          {!streaming && (
            <Button
              size="sm"
              variant="ghost"
              className="-my-1 h-6 shrink-0 px-2 text-xs"
              disabled={disabled}
              onClick={() => onRetry(message)}
            >
              Erneut versuchen
            </Button>
          )}
        </div>
      )}
      {!streaming && !message.text && !message.rich?.length && !message.error && (
        <p className="text-sm text-muted-foreground">(Keine Antwort)</p>
      )}
      {!streaming && (
        <div className="-ml-1.5 flex items-center gap-0.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover/message:opacity-100 pointer-coarse:opacity-100">
          {message.text && <AiCopyAction text={message.text} label="Antwort kopieren" />}
          <ResponseAction
            label="Antwort neu generieren"
            disabled={disabled}
            onClick={() => onRetry(message)}
          >
            <RotateCcw className="size-3.5" />
          </ResponseAction>
          <AiBranchSwitcher
            session={session}
            id={message.id}
            disabled={disabled}
            onBranch={onBranch}
          />
          <AiMessageTime at={message.createdAt} />
        </div>
      )}
    </article>
  );
}
