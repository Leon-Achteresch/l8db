import { ArrowDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AiSession } from "@/lib/ai/store";
import type { AiEvent, AiMessage } from "@/lib/db/ai";
import { AiApproval } from "./ai-approval";
import { AiAssistantMessage } from "./ai-assistant-message";
import { AiUserMessage } from "./ai-user-message";
import { MessageScroller } from "./beui/agents/message-scroller";

interface Props {
  messages: AiMessage[];
  session?: AiSession;
  approvals: AiEvent[];
  fullPage?: boolean;
  runId: string | null;
  runStatus: string;
  onResolved: (id: string) => void;
  onError: (message: string) => void;
  onEdit: (message: AiMessage, text: string) => void;
  onRetry: (message: AiMessage) => void;
  onBranch: (id: string | undefined) => void;
}
export function AiTranscript({
  messages,
  session,
  approvals,
  fullPage,
  runId,
  runStatus,
  onResolved,
  onError,
  onEdit,
  onRetry,
  onBranch,
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
        viewportClassName="px-5 py-6"
        contentClassName={`space-y-4 ${fullPage ? "mx-auto max-w-3xl" : ""}`}
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
              last={index === messages.length - 1}
              status={runStatus}
              disabled={Boolean(runId)}
              onRetry={onRetry}
              onBranch={onBranch}
            />
          ),
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
      {!following && (
        <button
          type="button"
          aria-label="Zum Ende springen"
          onClick={() =>
            viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" })
          }
          className="absolute bottom-3 left-1/2 grid size-8 -translate-x-1/2 place-items-center rounded-full border bg-background text-muted-foreground shadow-md outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowDown className="size-4" />
        </button>
      )}
    </div>
  );
}
