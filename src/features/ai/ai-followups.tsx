import { CornerDownRight } from "lucide-react";

export function AiFollowups({
  questions,
  onAsk,
}: {
  questions: string[];
  onAsk: (question: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <section className="mt-3 flex flex-col items-start gap-1" aria-label="Mögliche nächste Fragen">
      {questions.map((question) => (
        <button
          key={question}
          type="button"
          onClick={() => onAsk(question)}
          className="flex max-w-full items-start gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-left text-xs text-foreground/80 outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <CornerDownRight className="mt-0.5 size-3 shrink-0 text-muted-foreground" />
          <span className="min-w-0">{question}</span>
        </button>
      ))}
    </section>
  );
}
