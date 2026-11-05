import { ChevronDown } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AiSession } from "@/lib/ai/store";
import { aiBranches } from "@/lib/ai/thread";
import type { AiMessage } from "@/lib/db/ai";
import { AiAssistantMessage } from "./ai-assistant-message";
import { AiUserMessage } from "./ai-user-message";
import { MessageScroller } from "./beui/agents/message-scroller";

const same = (before: unknown, after: unknown) =>
  Object.is(before, after) ||
  (Array.isArray(before) &&
    Array.isArray(after) &&
    before.length === after.length &&
    before.every((value, index) => value === after[index]));
const sameProps = <P extends object>(before: P, after: P) => {
  const keys = Object.keys(after) as (keyof P)[];
  return (
    keys.length === Object.keys(before).length && keys.every((key) => same(before[key], after[key]))
  );
};
const UserMessage = memo(AiUserMessage, sameProps);
const AssistantMessage = memo(AiAssistantMessage, sameProps);

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
  const latest = useRef({ onEdit, onRetry, onBranch, onAsk });
  useLayoutEffect(() => {
    latest.current = { onEdit, onRetry, onBranch, onAsk };
  });
  const handlers = useMemo(
    () => ({
      edit: (message: AiMessage, text: string) => latest.current.onEdit(message, text),
      retry: (message: AiMessage) => latest.current.onRetry(message),
      branch: (id: string | undefined) => latest.current.onBranch(id),
      ask: (question: string) => latest.current.onAsk(question),
    }),
    [],
  );
  const branches = aiBranches(session);
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
        contentClassName="mx-auto w-full max-w-[44rem] space-y-3 [&>[data-from=user]:not(:first-child)]:mt-6"
      >
        {messages.map((message, index) => {
          const last = index === messages.length - 1;
          return message.role === "user" ? (
            <UserMessage
              key={message.id ?? index}
              message={message}
              siblings={branches.get(message.id)}
              disabled={Boolean(runId)}
              onEdit={handlers.edit}
              onBranch={handlers.branch}
            />
          ) : (
            <AssistantMessage
              key={message.id ?? index}
              message={message}
              siblings={branches.get(message.id)}
              streaming={Boolean(runId) && last}
              status={runId && last ? runStatus : ""}
              disabled={Boolean(runId)}
              onRetry={handlers.retry}
              onBranch={handlers.branch}
              onFollowup={!runId && last ? handlers.ask : undefined}
            />
          );
        })}
      </MessageScroller>
      {!following && (
        <button
          type="button"
          onClick={() =>
            viewport.current?.scrollTo({ top: viewport.current.scrollHeight, behavior: "smooth" })
          }
          className="absolute bottom-3 left-1/2 flex h-7 -translate-x-1/2 items-center gap-1 rounded-full bg-card px-3 text-xs text-muted-foreground shadow-[0_0_0_1px_color-mix(in_oklab,var(--foreground)_6%,transparent),0_6px_16px_-6px_oklch(0_0_0/25%)] outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown className="size-3.5" />
          Zum Ende
        </button>
      )}
    </div>
  );
}
