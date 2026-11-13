import { Brain, CircleAlert, RotateCcw } from "lucide-react";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { stripAiFollowups } from "@/lib/ai/result";
import { interleaveAiRich } from "@/lib/ai/rich";
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
  siblings,
  streaming,
  status,
  disabled,
  onRetry,
  onBranch,
  onFollowup,
}: {
  message: AiMessage;
  siblings?: (string | undefined)[];
  streaming: boolean;
  status: string;
  disabled: boolean;
  onRetry: (message: AiMessage) => void;
  onBranch: (id: string | undefined) => void;
  onFollowup?: (question: string) => void;
}) {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const [open, setOpen] = useState(false);
  const live = streaming && !easyMode;
  const showWork = live || open;
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
      className="group/message relative min-w-0 space-y-1.5"
    >
      {(streaming || message.stopped || (hasWork && message.durationMs !== undefined)) && (
        <AiTurnHeader
          streaming={streaming}
          startedAt={message.createdAt}
          durationMs={message.durationMs}
          stopped={message.stopped}
          steps={work?.length ?? 0}
          open={showWork}
          onToggle={hasWork && !live ? () => setOpen(!open) : undefined}
        />
      )}
      {showWork && message.reasoning && (
        <AiWorkRow
          icon={Brain}
          active={thinking}
          tone="lead"
          label={thinking ? "Denkt nach" : thought || "Gedacht"}
          detail={message.reasoning}
        />
      )}
      {parts.map((part, index) => (
        <Fragment key={String(index)}>
          {part.text.trim() ? (
            <AiAnswer
              text={part.text}
              streaming={streaming && index === parts.length - 1}
              onFollowup={streaming ? undefined : onFollowup}
            />
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
          className="flex items-start gap-2.5 rounded-2xl bg-destructive/[0.08] px-3.5 py-2.5 text-xs"
        >
          <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground/80">
            {message.error}
          </p>
          {!streaming && (
            <Button
              size="sm"
              variant="ghost"
              className="-my-1 h-6 shrink-0 rounded-full bg-background/70 px-2.5 text-xs hover:bg-background"
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
        <div className="-ml-1.5 flex items-center gap-0.5 pt-0.5">
          {message.text && (
            <AiCopyAction text={stripAiFollowups(message.text)} label="Antwort kopieren" />
          )}
          <ResponseAction
            label="Antwort neu generieren"
            disabled={disabled}
            onClick={() => onRetry(message)}
          >
            <RotateCcw className="size-3.5" />
          </ResponseAction>
          <AiBranchSwitcher
            siblings={siblings}
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
