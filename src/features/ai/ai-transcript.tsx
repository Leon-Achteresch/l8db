import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiSession } from "@/lib/ai/store";
import type { AiMessage } from "@/lib/db/ai";
import { AiAssistantMessage } from "./ai-assistant-message";
import { AiUserMessage } from "./ai-user-message";
import { MessageScroller } from "./beui/agents/message-scroller";

interface Props {
  messages: AiMessage[];
  session?: AiSession;
  runId: string | null;
  runStatus: string;
  onEdit: (message: AiMessage, text: string) => void;
  onRetry: (message: AiMessage) => void;
  onBranch: (id: string | undefined) => void;
  onAsk: (question: string) => void;
}
export function AiTranscript({
  messages,
  session,
  runId,
  runStatus,
  onEdit,
  onRetry,
  onBranch,
  onAsk,
}: Props) {
  const viewport = useRef<HTMLElement>(null);
  const [following, setFollowing] = useState(true);
  useEffect(() => {
    if (runId) viewport.current?.scrollTo({ top: viewport.current.scrollHeight });
  }, [runId]);
  return (
    <div className="relative min-h-0 flex-1">
      <MessageScroller
        label="Gespräch mit AI"
        busy={Boolean(runId)}
        smooth={false}
        onFollowChange={setFollowing}
        viewportRef={viewport}
        className="h-full"
        viewportClassName="px-4 pt-5 pb-6 sm:px-6"
        contentClassName="mx-auto w-full max-w-[44rem] space-y-3 [&>[data-from=user]:not(:first-child)]:mt-7 [&>[data-from=user]:not(:first-child)]:border-t [&>[data-from=user]:not(:first-child)]:pt-6"
      >
        {messages.map((message, index) =>
          message.role === "user" ? (
            <AiUserMessage
              key={message.id ?? index}
              message={message}
              session={session}
              disabled={Boolean(runId)}
              onEdit={onEdit}
              onBranch={onBranch}
            />
          ) : (
            <AiAssistantMessage
              key={message.id ?? index}
              message={message}
              session={session}
              streaming={Boolean(runId) && index === messages.length - 1}
              status={runStatus}
              disabled={Boolean(runId)}
              onRetry={onRetry}
              onBranch={onBranch}
              onFollowup={!runId && index === messages.length - 1 ? onAsk : undefined}
            />
          ),
        )}
      </MessageScroller>
      {!following && (
        <button
          type="button"
          onClick={() =>
            viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" })
          }
          className="absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full border bg-background px-2.5 text-xs text-muted-foreground shadow-[0_4px_12px_-4px_oklch(0_0_0/18%)] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className="size-3.5" />
          Zum Ende
        </button>
      )}
    </div>
  );
}
