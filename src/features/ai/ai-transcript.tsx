import { Sparkles } from "lucide-react";
import type { AiEvent, AiMessage } from "@/lib/db/ai";
import { AiAnswer } from "./ai-answer";
import { AiApproval } from "./ai-approval";
import { AiRichContent } from "./ai-rich-content";
import { ThinkingShimmer } from "./beui/agents/loading-states";
import { Message, MessageContent, MessageHeader } from "./beui/agents/message";
import { MessageBubble, MessageBubbleContent } from "./beui/agents/message-bubble";
import { MessageScroller } from "./beui/agents/message-scroller";

interface Props {
  messages: AiMessage[];
  reasoning: string;
  events: AiEvent[];
  approvals: AiEvent[];
  fullPage?: boolean;
  runId: string | null;
  onResolved: (id: string) => void;
  onError: (message: string) => void;
}
export function AiTranscript({
  messages,
  reasoning,
  approvals,
  fullPage,
  runId,
  onResolved,
  onError,
}: Props) {
  return (
    <MessageScroller
      label="Gespräch mit AI"
      busy={Boolean(runId)}
      smooth={false}
      className="min-h-0 flex-1"
      viewportClassName="px-5 py-6"
      contentClassName={`space-y-5 ${fullPage ? "mx-auto max-w-3xl" : ""}`}
    >
      {messages.length === 0 && (
        <div className="flex min-h-48 flex-col items-center justify-center px-3 text-center">
          <div className="mb-4 flex size-10 items-center justify-center rounded-2xl border bg-muted/30">
            <Sparkles className="size-5 text-muted-foreground" />
          </div>
          <h2 className="text-sm font-medium">Deine Daten. Ein Gespräch.</h2>
          <p className="mt-2 max-w-64 text-xs leading-relaxed text-muted-foreground">
            Stelle eine Frage zu deiner Datenbank.
          </p>
        </div>
      )}
      {messages.map((message, index) => {
        const streaming = Boolean(runId) && index === messages.length - 1;
        return (
          <Message
            key={message.id ?? `${message.role}-${index}`}
            from={message.role}
            animateIn={false}
            className="text-xs"
          >
            <MessageContent className="min-w-0 flex-1">
              <MessageHeader className="mb-1 text-[10px] font-medium text-muted-foreground">
                {message.role === "user" ? "Du" : "Agent"}
              </MessageHeader>
              {message.role === "user" ? (
                <MessageBubble variant="soft" animateIn={false} className="ml-6 text-xs">
                  <MessageBubbleContent className="whitespace-pre-wrap break-words text-xs leading-relaxed">
                    {message.text}
                  </MessageBubbleContent>
                </MessageBubble>
              ) : (
                <div className="space-y-3">
                  {message.text ? (
                    <AiAnswer text={message.text} streaming={streaming} />
                  ) : streaming ? (
                    <ThinkingShimmer className="text-xs">Denkt …</ThinkingShimmer>
                  ) : (
                    <p className="text-xs text-muted-foreground">Keine Textantwort.</p>
                  )}
                  {message.rich?.length ? (
                    <AiRichContent blocks={message.rich} running={streaming} />
                  ) : null}
                </div>
              )}
            </MessageContent>
          </Message>
        );
      })}
      {reasoning && (
        <details className="rounded-lg bg-muted/20 px-3 py-1.5 text-xs">
          <summary className="min-h-7 cursor-pointer py-1 text-muted-foreground">
            Überlegungen
          </summary>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{reasoning}</p>
        </details>
      )}
      {runId &&
        approvals.map((event) => (
          <AiApproval
            key={String(event.data.id)}
            event={event}
            runId={runId}
            onResolved={onResolved}
            onError={onError}
          />
        ))}
    </MessageScroller>
  );
}
