import { useMemo } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { AiTranscript } from "../../src/features/ai/ai-transcript";
import { AiFigureContext, useAiFigureNumbers } from "../../src/lib/ai/figures";
import { aiFigures } from "../../src/lib/ai/result";
import { type AiSession, useAiStore } from "../../src/lib/ai/store";
import { aiThread } from "../../src/lib/ai/thread";
import type { AiMessage } from "../../src/lib/db/ai";

const TURNS = 200;
const table = `monat\tumsatz\tkunden\n${Array.from(
  { length: 30 },
  (_, row) =>
    `2026-${String((row % 12) + 1).padStart(2, "0")}\t${48_000 + row * 137}\t${900 + row}`,
).join("\n")}\n(30 rows)`;
const answer =
  "Der Umsatz ist seit Mai um **18 %** gestiegen.\n\n- Juli war der stärkste Monat\n- Danach rund `56.000 €`\n\n";

function assistant(index: number, parentId: string): AiMessage {
  return {
    id: `a${index}`,
    parentId,
    role: "assistant",
    createdAt: index * 1000,
    durationMs: 4200,
    reasoning: "Ich prüfe zuerst die Bestelltabelle.",
    text: answer,
    rich: [
      ...Array.from({ length: 5 }, (_, step) => ({
        type: "tool" as const,
        id: `t${index}-${step}`,
        name: "query",
        status: "success",
        sql: `SELECT ${step} FROM orders`,
        output: "monat\tumsatz\n2026-05\t48210\n(1 rows)",
        at: 0,
      })),
      {
        type: "tool" as const,
        id: `v${index}`,
        name: "visualize",
        status: "success",
        title: `Umsatz ${index}`,
        sql: "SELECT monat, umsatz FROM orders",
        output: table,
        chart: { chart: "line", x: "monat", y: ["umsatz"] },
        at: answer.length,
      },
    ],
  };
}

const messages: AiMessage[] = [];
for (let index = 0; index <= TURNS; index++) {
  messages.push({
    id: `u${index}`,
    parentId: index ? `a${index - 1}` : null,
    role: "user",
    text: `Frage ${index}: Wie hat sich der Umsatz entwickelt?`,
    createdAt: index * 1000,
  });
  if (index < TURNS) messages.push(assistant(index, `u${index}`));
}
messages.push({ ...assistant(TURNS + 1, "u10"), id: "a10b" });
messages.push({ id: "live", parentId: `u${TURNS}`, role: "assistant", text: "", createdAt: 0 });

let live: AiSession = {
  id: "perf-stream",
  title: "Streaming",
  profileId: "copilot",
  nativeId: null,
  cwd: "/tmp",
  connectionIds: [],
  updatedAt: 1,
  leafId: "live",
  messages,
};
useAiStore.getState().saveSession(live);
useAiStore.getState().selectSession(live.id);

function App() {
  const session = useAiStore((state) => state.sessions.find((entry) => entry.id === live.id));
  const thread = useMemo(() => aiThread(session), [session]);
  const figures = useMemo(() => aiFigures(thread), [thread]);
  const numbers = useAiFigureNumbers(figures);
  const scope = useMemo(
    () => ({ numbers, shelf: false, focused: null, focus: () => undefined }),
    [numbers],
  );
  return (
    <div className="flex h-screen w-[440px] flex-col">
      <AiFigureContext value={scope}>
        <AiTranscript
          messages={thread}
          session={session}
          runId="perf"
          runStatus=""
          onEdit={() => undefined}
          onRetry={() => undefined}
          onBranch={() => undefined}
          onAsk={() => undefined}
        />
      </AiFigureContext>
    </div>
  );
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function stream(deltas: number) {
  const durations: number[] = [];
  for (let delta = 0; delta < deltas; delta++) {
    await tick();
    const started = performance.now();
    flushSync(() => {
      const next = [...live.messages];
      const last = next[next.length - 1];
      next[next.length - 1] = { ...last, text: `${last.text}Wort ${delta} ` };
      live = { ...live, messages: next, updatedAt: live.updatedAt + 1 };
      useAiStore.getState().saveSession(live);
    });
    durations.push(performance.now() - started);
  }
  return durations;
}

Object.assign(window, { aiStream: stream, aiStreamMessages: messages.length });
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
