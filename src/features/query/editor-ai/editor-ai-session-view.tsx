import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { InlineEditSession } from "@/lib/ai/editor/inline-edit";
import { EditorAiHunk } from "./editor-ai-hunk";
import { EditorAiPrompt } from "./editor-ai-prompt";

export function EditorAiSessionView({ session }: { session: InlineEditSession }) {
  const snapshot = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return (
    <>
      {createPortal(<EditorAiPrompt session={session} snapshot={snapshot} />, snapshot.promptNode)}
      {snapshot.hunks.map((hunk) =>
        hunk.node
          ? createPortal(
              <EditorAiHunk
                hunk={hunk}
                font={snapshot.font}
                onAccept={() => session.accept(hunk.index)}
                onReject={() => session.reject(hunk.index)}
              />,
              hunk.node,
              `${session.id}-${hunk.index}`,
            )
          : null,
      )}
    </>
  );
}
