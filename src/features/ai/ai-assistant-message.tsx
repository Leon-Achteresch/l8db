import { RotateCcw } from "lucide-react";
import { Fragment } from "react";
import { Button } from "@/components/ui/button";
import { interleaveAiRich } from "@/lib/ai/rich";
import type { AiSession } from "@/lib/ai/store";
import type { AiMessage } from "@/lib/db/ai";
import { cn } from "@/lib/utils";
import { AiAnswer } from "./ai-answer";
import { AiBranchSwitcher } from "./ai-branch-switcher";
import { AiCopyAction } from "./ai-copy-action";
import { AiRichContent } from "./ai-rich-content";
import { ThinkingShimmer } from "./beui/agents/loading-states";
import { ResponseAction } from "./beui/agents/streaming-response";

export function AiAssistantMessage({
  message,
  session,
  streaming,
  last,
  status,
  disabled,
  onRetry,
  onBranch,
}: {
  message: AiMessage;
  session?: AiSession;
  streaming: boolean;
  last: boolean;
  status: string;
  disabled: boolean;
  onRetry: (message: AiMessage) => void;
  onBranch: (id: string | undefined) => void;
}) {
  const parts = interleaveAiRich(message.text, message.rich);
  const waiting = streaming && !parts[parts.length - 1].text.trim();
  return (
    <article
      data-slot="message"
      data-from="assistant"
      aria-label="Antwort"
      aria-busy={streaming}
      className="group/message space-y-3 text-sm"
    >
      {message.reasoning && (
        <details className="group/thinking text-xs text-muted-foreground">
          <summary className="inline-flex min-h-7 cursor-pointer list-none items-center gap-1 rounded-md hover:text-foreground">
            {streaming && !message.text ? (
              <ThinkingShimmer className="text-xs">Denkt nach …</ThinkingShimmer>
            ) : (
              "Gedankengang"
            )}
            <span aria-hidden="true" className="transition-transform group-open/thinking:rotate-90">
              ›
            </span>
          </summary>
          <p className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap border-l-2 pl-3 leading-relaxed">
            {message.reasoning}
          </p>
        </details>
      )}
      {parts.map((part, index) => (
        <Fragment key={String(index)}>
          {part.text.trim() ? (
            <AiAnswer text={part.text} streaming={streaming && index === parts.length - 1} />
          ) : null}
          {part.blocks.length ? <AiRichContent blocks={part.blocks} running={streaming} /> : null}
        </Fragment>
      ))}
      {waiting && !(message.reasoning && !message.text) && (
        <ThinkingShimmer className="text-xs">{status || "Denkt nach …"}</ThinkingShimmer>
      )}
      {message.error && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-destructive/25 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
        >
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words">{message.error}</p>
          {!streaming && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-xs"
              disabled={disabled}
              onClick={() => onRetry(message)}
            >
              Erneut versuchen
            </Button>
          )}
        </div>
      )}
      {!streaming && message.stopped && (
        <p className="text-xs text-muted-foreground">Antwort angehalten.</p>
      )}
      {!streaming &&
        !message.text &&
        !message.rich?.length &&
        !message.error &&
        !message.stopped && <p className="text-xs text-muted-foreground">Keine Textantwort.</p>}
      {!streaming && (
        <div
          className={cn(
            "-ml-1.5 flex items-center gap-0.5 transition-opacity focus-within:opacity-100 group-hover/message:opacity-100",
            !last && "opacity-0",
          )}
        >
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
        </div>
      )}
    </article>
  );
}
